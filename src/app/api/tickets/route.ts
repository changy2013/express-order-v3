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
      const compensations = await query('SELECT * FROM compensation_records WHERE ticket_id = $1 ORDER BY created_at', [id]);
      const invLogs = await query('SELECT * FROM inventory_logs WHERE ticket_id = $1 ORDER BY created_at', [id]);

      // 尝试从 V2 获取最新运单信息（实时），降级使用本地快照
      const v2Result = await V2Client.getWaybill(ticket.rows[0].waybill_no);
      const localSnapshot = await query('SELECT * FROM waybill_snapshots WHERE waybill_no = $1', [ticket.rows[0].waybill_no]);

      return NextResponse.json({
        ticket: ticket.rows[0],
        approvals: approvals.rows,
        scans: scans.rows,
        compensations: compensations.rows,
        inventoryLogs: invLogs.rows,
        waybill: {
          source: v2Result.data ? 'v2_real_time' : 'local_cache',
          data: v2Result.data || localSnapshot.rows[0] || null,
          syncedAt: localSnapshot.rows[0]?.last_synced_at || null,
          v2Available: !v2Result.error,
        },
      });
    }

    // 统计数据
    if (searchParams.get('stats') === 'true') {
      const pending = await query(
        "SELECT COUNT(*) as count FROM exception_tickets WHERE current_status IN ('pending_approval', 'level1_approving', 'level2_approving')"
      );
      const todayNew = await query(
        "SELECT COUNT(*) as count FROM exception_tickets WHERE created_at >= CURRENT_DATE"
      );
      const nearTimeout = await query(
        `SELECT COUNT(*) as count FROM exception_tickets 
         WHERE current_status IN ('pending_approval', 'level1_approving', 'level2_approving')
           AND updated_at < NOW() - INTERVAL '42 hours'` // 距离48小时超时还剩6小时
      );
      const totalCompensation = await query(
        "SELECT COALESCE(SUM(amount), 0) as total FROM compensation_records WHERE status != 'cancelled'"
      );
      const byStatus = await query(
        `SELECT current_status, COUNT(*) as count FROM exception_tickets GROUP BY current_status ORDER BY count DESC`
      );

      return NextResponse.json({
        pendingCount: parseInt(pending.rows[0]?.count || '0'),
        todayNewCount: parseInt(todayNew.rows[0]?.count || '0'),
        nearTimeoutCount: parseInt(nearTimeout.rows[0]?.count || '0'),
        totalCompensationAmount: parseFloat(totalCompensation.rows[0]?.total || '0'),
        byStatus: byStatus.rows,
      });
    }

    // 工单列表（支持多维度筛选）
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, parseInt(searchParams.get('pageSize') || '20', 10));
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const waybillNo = searchParams.get('waybill_no');
    const source = searchParams.get('source');
    const approver = searchParams.get('approver'); // 新增：按审批人筛选

    const where: string[] = [];
    const params: any[] = [];
    let idx = 1;

    // 支持多状态筛选（逗号分隔）
    if (status) {
      const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
      if (statuses.length === 1) {
        params.push(statuses[0]);
        where.push(`et.current_status = $${idx++}`);
      } else if (statuses.length > 1) {
        params.push(statuses);
        where.push(`et.current_status = ANY($${idx++}::text[])`);
      }
    }
    if (type) { params.push(type); where.push(`et.exception_type = $${idx++}`); }
    if (waybillNo) { params.push(`%${waybillNo}%`); where.push(`et.waybill_no ILIKE $${idx++}`); }
    if (source) { params.push(source); where.push(`et.source = $${idx++}`); }

    // 按审批人筛选：查找曾处理该工单的审批人
    if (approver) {
      params.push(approver);
      where.push(`et.id IN (SELECT ticket_id FROM approval_records WHERE approver = $${idx++})`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const offset = (page - 1) * pageSize;

    // 读取审批超时配置（用于计算即将超时标记）
    const configRes = await query(
      "SELECT config_value FROM approval_configs WHERE config_key = 'approval_timeout_hours'"
    );
    const timeoutConfig = configRes.rows[0]?.config_value || { level1: 48, level2: 24 };
    const level1Hours = timeoutConfig.level1 || 48;
    const level2Hours = timeoutConfig.level2 || 24;

    const r = await query(
      `SELECT et.*,
        CASE 
          WHEN et.current_status IN ('pending_approval', 'level1_approving') 
            THEN et.updated_at + INTERVAL '1 hour' * $${idx}
          WHEN et.current_status = 'level2_approving'
            THEN et.updated_at + INTERVAL '1 hour' * $${idx + 1}
          ELSE NULL
        END AS timeout_at,
        CASE 
          WHEN et.current_status IN ('pending_approval', 'level1_approving') 
            AND et.updated_at < NOW() - INTERVAL '1 hour' * ($${idx} - 6)
            THEN true
          WHEN et.current_status = 'level2_approving'
            AND et.updated_at < NOW() - INTERVAL '1 hour' * ($${idx + 1} - 6)
            THEN true
          ELSE false
        END AS is_near_timeout
       FROM exception_tickets et ${whereSql} ORDER BY et.created_at DESC LIMIT $${idx + 2} OFFSET $${idx + 3}`,
      [...params, level1Hours, level2Hours, pageSize, offset]
    );
    const countR = await query(
      `SELECT COUNT(*) as total FROM exception_tickets et ${whereSql}`,
      params
    );

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
    const { waybill_no, exception_type, exception_subtype, description, reported_by, severity, amount } = body;

    if (!waybill_no || !exception_type || !reported_by) {
      return NextResponse.json({ error: '缺少必填参数: waybill_no, exception_type, reported_by' }, { status: 400 });
    }

    // Step 1: 实时调用 V2 接口校验运单存在性（核心校验，不能只查本地快照）
    const waybillResult = await V2Client.getWaybill(waybill_no);
    if (waybillResult.error) {
      return NextResponse.json({ error: `运单校验失败: ${waybillResult.error}` }, { status: 400 });
    }

    // Step 2: 检查同类型未关闭工单（同类型异常不允许重复上报）
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

    // Step 3: 读取分级审批配置，确定初始状态
    const configRes = await query(
      "SELECT config_value FROM approval_configs WHERE config_key = 'approval_level_thresholds'"
    );
    const thresholds = configRes.rows[0]?.config_value || { level1_max_amount: 5000 };
    const ticketAmount = amount || waybillResult.data?.total_amount || 0;
    // 手工上报工单从 pending_approval 开始（需要人工提交审批）
    const initialStatus = 'pending_approval';

    // Step 4: 创建工单
    const id = crypto.randomUUID();
    const ticketNo = `EX${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    await query(
      `INSERT INTO exception_tickets(id, ticket_no, waybill_no, source, exception_type, exception_subtype, severity, description, reported_by, current_status, amount)
       VALUES($1, $2, $3, 'manual', $4, $5, $6, $7, $8, $9, $10)`,
      [id, ticketNo, waybill_no, exception_type, exception_subtype || null,
       severity || 'medium', description || null, reported_by, initialStatus, ticketAmount]
    );

    // Step 5: 更新本地快照
    if (waybillResult.data) {
      const d = waybillResult.data;
      await query(
        `INSERT INTO waybill_snapshots(id, waybill_no, receiver_name, receiver_phone, receiver_address, total_amount, sku_summary, last_synced_at)
         VALUES($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (waybill_no) DO UPDATE SET
           receiver_name = EXCLUDED.receiver_name,
           receiver_phone = EXCLUDED.receiver_phone,
           receiver_address = EXCLUDED.receiver_address,
           total_amount = EXCLUDED.total_amount,
           sku_summary = EXCLUDED.sku_summary,
           last_synced_at = NOW()`,
        [crypto.randomUUID(), waybill_no, d.receiver_name, d.receiver_phone, d.receiver_address,
         d.total_amount, JSON.stringify(d.sku_items || [])]
      );
    }

    return NextResponse.json({ success: true, id, ticketNo });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '创建工单失败' }, { status: 500 });
  }
}
