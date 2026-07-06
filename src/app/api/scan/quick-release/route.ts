import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';

/**
 * POST /api/scan/quick-release
 * 品控误判快速放行
 *
 * 仅品控主管（reviewer_role = 'qc_supervisor'）可操作
 * 操作留痕，不允许静默放行
 * 在同一事务内：关闭工单 + 解锁批次 + 写入审批记录
 *
 * Body:
 * - ticket_id: 工单 ID
 * - reviewer: 操作人标识（用于记录）
 * - reviewer_role: 操作人角色（必须为 'qc_supervisor' 或 'admin'）
 * - reason: 复核原因（必填，留痕）
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { ticket_id, reviewer, reviewer_role, reason } = body;

  if (!ticket_id || !reviewer || !reason) {
    return NextResponse.json({ error: '缺少必填参数: ticket_id, reviewer, reason' }, { status: 400 });
  }

  // 后端强校验：仅品控主管可执行快速放行（前端隐藏入口不算数，必须后端校验）
  const allowedRoles = ['qc_supervisor', 'admin'];
  const effectiveRole = reviewer_role || reviewer; // 兼容旧版前端
  if (!allowedRoles.includes(effectiveRole)) {
    return NextResponse.json(
      { error: '权限不足：仅品控主管（qc_supervisor）可执行快速放行操作，审批人无此权限' },
      { status: 403 }
    );
  }

  if (!reason || reason.trim().length < 5) {
    return NextResponse.json(
      { error: '复核原因不能为空且至少5个字符，不允许静默放行' },
      { status: 400 }
    );
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const conn = await pool.connect();

  try {
    await conn.query('BEGIN');

    // 获取工单当前状态（乐观锁）
    const ticketRes = await conn.query(
      'SELECT id, current_status, version, source, reported_by FROM exception_tickets WHERE id = $1',
      [ticket_id]
    );

    if (ticketRes.rows.length === 0) {
      await conn.query('ROLLBACK');
      return NextResponse.json({ error: '工单不存在' }, { status: 404 });
    }

    const t = ticketRes.rows[0];

    // 快速放行只适用于品控工单（source = 'scan'）
    if (t.source !== 'scan') {
      await conn.query('ROLLBACK');
      return NextResponse.json({ error: '快速放行仅适用于品控扫描工单（手工上报工单请走正常审批流程）' }, { status: 400 });
    }

    // 允许放行的工单状态
    const allowedStatuses = ['pending_approval', 'level1_approving', 'level2_approving'];
    if (!allowedStatuses.includes(t.current_status)) {
      await conn.query('ROLLBACK');
      return NextResponse.json({ error: `工单当前状态（${t.current_status}）不允许快速放行` }, { status: 409 });
    }

    // 乐观锁更新工单状态（防并发冲突）
    const updateResult = await conn.query(
      `UPDATE exception_tickets 
       SET current_status = 'completed', version = version + 1, updated_at = NOW()
       WHERE id = $1 AND version = $2`,
      [ticket_id, t.version]
    );

    if (updateResult.rowCount === 0) {
      await conn.query('ROLLBACK');
      return NextResponse.json({ error: '并发冲突：工单已被其他操作处理，请刷新' }, { status: 409 });
    }

    // 解锁扫描批次（批次状态 = unlocked）
    await conn.query(
      "UPDATE scan_records SET batch_status = 'unlocked' WHERE ticket_id = $1",
      [ticket_id]
    );

    // 留痕：写入审批记录（action 标记为 quick_released，区别于正常审批）
    await conn.query(
      `INSERT INTO approval_records(id, ticket_id, approver, approval_level, action, comment, operation_token)
       VALUES($1, $2, $3, 'qc_supervisor', 'approved', $4, $5)`,
      [
        crypto.randomUUID(),
        ticket_id,
        reviewer,
        `【品控主管误判快速放行】复核原因: ${reason.trim()}`,
        crypto.randomUUID(),
      ]
    );

    await conn.query('COMMIT');

    return NextResponse.json({
      success: true,
      message: '快速放行完成，批次已解锁，操作已留痕',
    });
  } catch (error: any) {
    await conn.query('ROLLBACK');
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    conn.release();
    await pool.end();
  }
}
