import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { V2Client } from '@/lib/v2-client';
import { QCEngine } from '@/lib/qc-engine';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const conn = await pool.connect();

  try {
    const body = await req.json();
    const { waybill_no, sku_code, sku_name, batch_no, operator, scanned_qty, damage_level, spec_match } = body;

    if (!waybill_no || !sku_code || !operator) {
      return NextResponse.json({ error: '缺少必填参数: waybill_no, sku_code, operator' }, { status: 400 });
    }

    // Step 1: 通过 V2 接口校验 SKU 归属
    const skuResult = await V2Client.verifySku(waybill_no, sku_code);
    if (skuResult.error || !skuResult.data?.exists) {
      return NextResponse.json({ error: skuResult.error || 'SKU 不存在或不属于该运单' }, { status: 400 });
    }

    // Step 2: 检查同一批次是否存在未关闭品控工单（幂等性）
    const openTicket = await QCEngine.checkOpenTicket(waybill_no, sku_code, batch_no);
    if (openTicket.hasOpen) {
      // 只追加扫描记录，不重新创建工单
      await conn.query(
        `INSERT INTO scan_records(id, waybill_no, sku_code, sku_name, batch_no, operator, qc_result, qc_rule_detail, batch_status, ticket_id)
         VALUES($1, $2, $3, $4, $5, $6, 'fail', '重复扫描-已有未关闭工单', 'locked', $7)`,
        [crypto.randomUUID(), waybill_no, sku_code, sku_name || null, batch_no || null, operator, openTicket.ticketId]
      );
      return NextResponse.json({
        warning: '该批次已存在未关闭品控工单，仅追加扫描记录',
        ticketId: openTicket.ticketId,
        alreadyExists: true,
      });
    }

    // Step 3: 执行品控规则引擎
    const qcResult = await QCEngine.evaluate({
      skuCode: sku_code,
      skuName: sku_name || '',
      expectedQty: skuResult.data?.quantity || 0,
      scannedQty: scanned_qty || 0,
      damageLevel: damage_level,
      specMatch: spec_match,
      batchNo: batch_no,
    });

    if (qcResult.passed) {
      // 品控通过：记录扫描结果，批次状态 = normal
      await conn.query(
        `INSERT INTO scan_records(id, waybill_no, sku_code, sku_name, batch_no, operator, qc_result, qc_rule_detail, batch_status)
         VALUES($1, $2, $3, $4, $5, $6, 'pass', $7, 'normal')`,
        [crypto.randomUUID(), waybill_no, sku_code, sku_name || null, batch_no || null, operator, qcResult.detail]
      );
      return NextResponse.json({ passed: true, detail: qcResult.detail });
    }

    // Step 4: 品控异常 — 在一个事务内完成：批次锁定 + 创建工单 + 库存锁定
    const scanId = crypto.randomUUID();
    const ticketId = crypto.randomUUID();
    const ticketNo = `QC${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    try {
      await conn.query('BEGIN');

      // 插入扫描记录（异常，批次锁定）
      await conn.query(
        `INSERT INTO scan_records(id, waybill_no, sku_code, sku_name, batch_no, operator, qc_result, qc_rule_id, qc_rule_detail, batch_status, ticket_id)
         VALUES($1, $2, $3, $4, $5, $6, 'fail', $7, $8, 'locked', $9)`,
        [scanId, waybill_no, sku_code, sku_name || null, batch_no || null, operator, qcResult.ruleId, qcResult.detail, ticketId]
      );

      // 初始化库存记录（如不存在）
      await conn.query(
        `INSERT INTO inventory(id, sku_code, sku_name, total_qty, locked_qty)
         VALUES($1, $2, $3, 0, 0)
         ON CONFLICT (sku_code, warehouse) DO NOTHING`,
        [crypto.randomUUID(), sku_code, sku_name || '']
      );

      // 创建异常工单（来源标记 = 'scan'）
      await conn.query(
        `INSERT INTO exception_tickets(id, ticket_no, waybill_no, source, exception_type, severity, description, reported_by, current_status, approval_level, amount)
         VALUES($1, $2, $3, 'scan', $4, $5, $6, $7, 'pending_approval', $8, $9)`,
        [ticketId, ticketNo, waybill_no, qcResult.ruleName || '品控异常', 'medium', qcResult.detail, operator,
         'level1', skuResult.data?.quantity ? skuResult.data.quantity * 100 : 0]
      );

      await conn.query('COMMIT');

      return NextResponse.json({
        passed: false,
        ticketId,
        ticketNo,
        detail: qcResult.detail,
        ruleId: qcResult.ruleId,
        ruleName: qcResult.ruleName,
      });
    } catch (err) {
      await conn.query('ROLLBACK');
      throw err;
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '扫描处理失败' }, { status: 500 });
  } finally {
    conn.release();
  }
}
