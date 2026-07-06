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

    // Step 1: 通过 V2 接口校验 SKU 归属于该运单（实时接口校验，不能仅凭本地快照）
    const skuResult = await V2Client.verifySku(waybill_no, sku_code);
    if (skuResult.error || !skuResult.data?.exists) {
      return NextResponse.json({ error: skuResult.error || 'SKU 不存在或不属于该运单，扫描被拒绝' }, { status: 400 });
    }

    // Step 2: 幂等性检查 — 同一批次同一SKU存在未关闭品控工单时，只追加记录不重建工单
    const openTicket = await QCEngine.checkOpenTicket(waybill_no, sku_code, batch_no);
    if (openTicket.hasOpen) {
      // 追加扫描记录（幂等，不重置暂扣状态）
      await conn.query(
        `INSERT INTO scan_records(id, waybill_no, sku_code, sku_name, batch_no, operator, qc_result, qc_rule_detail, batch_status, ticket_id)
         VALUES($1, $2, $3, $4, $5, $6, 'fail', '重复扫描-该批次已有未关闭品控工单（幂等追加）', 'locked', $7)`,
        [crypto.randomUUID(), waybill_no, sku_code, sku_name || null, batch_no || null, operator, openTicket.ticketId]
      );
      return NextResponse.json({
        warning: '⚠️ 该批次已存在未关闭品控工单，仅追加扫描记录，不重新创建工单',
        ticketId: openTicket.ticketId,
        alreadyExists: true,
      });
    }

    // Step 3: 执行品控规则引擎（规则从数据库加载，非硬编码）
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
      // 品控通过：正常出库，批次状态 = normal
      await conn.query(
        `INSERT INTO scan_records(id, waybill_no, sku_code, sku_name, batch_no, operator, qc_result, qc_rule_detail, batch_status)
         VALUES($1, $2, $3, $4, $5, $6, 'pass', $7, 'normal')`,
        [crypto.randomUUID(), waybill_no, sku_code, sku_name || null, batch_no || null, operator, qcResult.detail]
      );
      return NextResponse.json({ passed: true, detail: qcResult.detail });
    }

    // Step 4: 品控异常 — 事务内原子操作：批次锁定 + 创建工单 + 库存锁定
    const scanId = crypto.randomUUID();
    const ticketId = crypto.randomUUID();
    const ticketNo = `QC${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    try {
      await conn.query('BEGIN');

      // 插入扫描记录（异常，批次置为 locked 暂扣状态）
      await conn.query(
        `INSERT INTO scan_records(id, waybill_no, sku_code, sku_name, batch_no, operator, qc_result, qc_rule_id, qc_rule_detail, batch_status, ticket_id)
         VALUES($1, $2, $3, $4, $5, $6, 'fail', $7, $8, 'locked', $9)`,
        [scanId, waybill_no, sku_code, sku_name || null, batch_no || null, operator,
         qcResult.ruleId || null, qcResult.detail, ticketId]
      );

      // 初始化库存记录（若不存在则创建）
      await conn.query(
        `INSERT INTO inventory(id, sku_code, sku_name, total_qty, locked_qty)
         VALUES($1, $2, $3, 10, 0)
         ON CONFLICT (sku_code, warehouse) DO NOTHING`,
        [crypto.randomUUID(), sku_code, sku_name || sku_code]
      );

      // 锁定库存（品控暂扣期间该批次 SKU 不可被其他运单引用）
      const invRes = await conn.query(
        "SELECT id, total_qty, locked_qty FROM inventory WHERE sku_code = $1 AND warehouse = 'default'",
        [sku_code]
      );
      if (invRes.rows.length > 0) {
        const { id: invId, total_qty, locked_qty } = invRes.rows[0];
        const lockQty = Math.min(skuResult.data?.quantity || 1, total_qty - locked_qty);
        if (lockQty > 0) {
          await conn.query(
            'UPDATE inventory SET locked_qty = locked_qty + $1, updated_at = NOW() WHERE id = $2',
            [lockQty, invId]
          );
          await conn.query(
            `INSERT INTO inventory_logs(id, sku_code, change_type, qty_change, qty_before, qty_after, reason, ticket_id)
             VALUES($1, $2, 'lock', $3, $4, $5, $6, $7)`,
            [crypto.randomUUID(), sku_code, lockQty, locked_qty, locked_qty + lockQty,
             `品控暂扣锁定：${qcResult.detail}`, ticketId]
          );
        }
      }

      // 创建异常工单（来源标记 = 'scan'，状态直接进入 level2_approving）
      // 题目要求：品控工单自动创建时直接进入二级审批
      await conn.query(
        `INSERT INTO exception_tickets(id, ticket_no, waybill_no, source, exception_type, severity, description, reported_by, current_status, approval_level, amount)
         VALUES($1, $2, $3, 'scan', $4, $5, $6, $7, 'level2_approving', 'level2', $8)`,
        [
          ticketId, ticketNo, waybill_no,
          qcResult.ruleName || '品控异常',
          'high', // 品控工单默认高严重度（直接影响货物出库）
          qcResult.detail,
          operator,
          skuResult.data?.quantity ? skuResult.data.quantity * 100 : 0, // 估算金额
        ]
      );

      await conn.query('COMMIT');

      return NextResponse.json({
        passed: false,
        ticketId,
        ticketNo,
        detail: qcResult.detail,
        ruleId: qcResult.ruleId,
        ruleName: qcResult.ruleName,
        status: 'level2_approving', // 告知前端：品控工单直接进入二级审批
      });
    } catch (err) {
      await conn.query('ROLLBACK');
      throw err;
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '扫描处理失败' }, { status: 500 });
  } finally {
    conn.release();
    await pool.end();
  }
}
