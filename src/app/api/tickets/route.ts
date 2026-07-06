import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { V2Client } from '@/lib/v2-client';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    // 单个工单详情（含关联数据）
    if (id) {
      const ticket = await query('SELECT * FROM exception_tickets WHERE id = $1', [id]);
      if (ticket.rows.length === 0) {
        return NextResponse.json({ error: '工单不存在' }, { status: 404 });
      }

      const approvals = await query('SELECT * FROM approval_records WHERE ticket_id = $1 ORDER BY created_at', [id]);
      const scans = await query('SELECT * FROM scan_records WHERE ticket_id = $1 ORDER BY scanned_at', [id]);
      const compensations = await query('SELECT * FROM compensation_records WHERE ticket_id = $1', [id]);

      // 尝试从 V2 获取最新运单信息
      const v2Result = await V2Client.getWaybill(ticket.rows[0].waybill_no);
      const localSnapshot = await query('SELECT * FROM waybill_snapshots WHERE waybill_no = $1', [ticket.rows[0].waybill_no]);

      return NextResponse.json({
        ticket: ticket.rows[0],
        approvals: approvals.rows,
        scans: scans.rows,
        compensations: compensations.rows,
        waybill: {
          source: v2Result.data ? 'v2_real_time' : 'local_cache',
          data: v2Result.data || localSnapshot.rows[0] || null,
          syncedAt: localSnapshot.rows[0]?.last_synced_at || null,
          v2Available: !v2Result.error,
        },
      });
    }

    // 工单列表
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, parseInt(searchParams.get('pageSize') || '20', 10));
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const waybillNo = searchParams.get('waybill_no');
    const source = searchParams.get('source');

    const where: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (status) { params.push(status); where.push(`current_status = $${idx++}`); }
    if (type) { params.push(type); where.push(`exception_type = $${idx++}`); }
    if (waybillNo) { params.push(`%${waybillNo}%`); where.push(`waybill_no ILIKE $${idx++}`); }
    if (source) { params.push(source); where.push(`source = $${idx++}`); }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;

    const r = await query(
      `SELECT * FROM exception_tickets ${whereSql} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, pageSize, offset]
    );
    const countR = await query(`SELECT COUNT(*) as total FROM exception_tickets ${whereSql}`, params);

    return NextResponse.json({
      tickets: r.rows,
      total: parseInt(countR.rows[0]?.total || '0'),
      page, pageSize,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { waybill_no, exception_type, exception_subtype, description, reported_by, severity } = body;

    if (!waybill_no || !exception_type || !reported_by) {
      return NextResponse.json({ error: '缺少必填参数: waybill_no, exception_type, reported_by' }, { status: 400 });
    }

    // Step 1: 实时调用 V2 接口校验运单存在性（关键校验）
    const waybillResult = await V2Client.getWaybill(waybill_no);
    if (waybillResult.error) {
      return NextResponse.json({ error: `运单校验失败: ${waybillResult.error}` }, { status: 400 });
    }

    // Step 2: 检查同类型未关闭工单（不允许重复上报）
    const existing = await query(
      `SELECT id, ticket_no, current_status FROM exception_tickets
       WHERE waybill_no = $1 AND exception_type = $2 AND source = 'manual'
         AND current_status NOT IN ('completed', 'closed')
       LIMIT 1`,
      [waybill_no, exception_type]
    );
    if (existing.rows.length > 0) {
      return NextResponse.json({
        error: `该运单已有同类型未关闭的异常工单: ${existing.rows[0].ticket_no} (${existing.rows[0].current_status})`,
        existingTicketId: existing.rows[0].id,
      }, { status: 409 });
    }

    // Step 3: 创建工单
    const id = crypto.randomUUID();
    const ticketNo = `EX${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    await query(
      `INSERT INTO exception_tickets(id, ticket_no, waybill_no, source, exception_type, exception_subtype, severity, description, reported_by, current_status, amount)
       VALUES($1, $2, $3, 'manual', $4, $5, $6, $7, $8, 'pending_approval', $9)`,
      [id, ticketNo, waybill_no, exception_type, exception_subtype || null, severity || 'medium',
       description || null, reported_by, waybillResult.data?.total_amount || 0]
    );

    // Step 4: 更新本地快照
    if (waybillResult.data) {
      const d = waybillResult.data;
      await query(
        `INSERT INTO waybill_snapshots(id, waybill_no, receiver_name, receiver_phone, receiver_address, total_amount, last_synced_at)
         VALUES($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (waybill_no) DO UPDATE SET
           total_amount = EXCLUDED.total_amount, last_synced_at = NOW()`,
        [crypto.randomUUID(), waybill_no, d.receiver_name, d.receiver_phone, d.receiver_address, d.total_amount]
      );
    }

    return NextResponse.json({ success: true, id, ticketNo });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '创建工单失败' }, { status: 500 });
  }
}
