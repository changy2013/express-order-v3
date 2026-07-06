import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { ticket_id, reviewer, reason } = body;

  if (!ticket_id || !reviewer || !reason) {
    return NextResponse.json({ error: '缺少必填参数: ticket_id, reviewer, reason' }, { status: 400 });
  }

  // 仅品控主管或管理员可操作
  if (reviewer !== 'qc_supervisor' && reviewer !== 'admin') {
    return NextResponse.json({ error: '仅品控主管可执行快速放行操作' }, { status: 403 });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const conn = await pool.connect();

  try {
    await conn.query('BEGIN');

    // 更新工单状态为已完成（绕过审批流程）
    const result = await conn.query(
      `UPDATE exception_tickets 
       SET current_status = 'completed', version = version + 1, updated_at = NOW()
       WHERE id = $1 AND current_status IN ('pending_approval', 'level1_approving')
       RETURNING id`,
      [ticket_id]
    );

    if (result.rowCount === 0) {
      await conn.query('ROLLBACK');
      return NextResponse.json({ error: '工单状态不允许快速放行或已被处理' }, { status: 409 });
    }

    // 解锁扫描批次
    await conn.query(
      `UPDATE scan_records SET batch_status = 'unlocked' WHERE ticket_id = $1`,
      [ticket_id]
    );

    // 记录审批（快速放行，留痕）
    await conn.query(
      `INSERT INTO approval_records(id, ticket_id, approver, approval_level, action, comment, operation_token)
       VALUES($1, $2, $3, 'level1', 'approved', $4, $5)`,
      [crypto.randomUUID(), ticket_id, reviewer, `快速放行(误判复核): ${reason}`, crypto.randomUUID()]
    );

    await conn.query('COMMIT');
    return NextResponse.json({ success: true, message: '快速放行完成' });
  } catch (error: any) {
    await conn.query('ROLLBACK');
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    conn.release();
  }
}
