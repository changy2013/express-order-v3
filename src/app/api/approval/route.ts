import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * POST /api/approval
 * 审批操作：通过/拒绝/转交
 *
 * Body:
 * - ticket_id: 工单 ID
 * - approver: 审批人
 * - action: 'approve' | 'reject' | 'transfer'
 * - comment: 审批意见
 * - operation_token: 幂等令牌
 * - approval_level: 'level1' | 'level2'
 * - transfer_to: 转交目标（仅 transfer 时）
 */
export async function POST(req: NextRequest) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const conn = await pool.connect();

  try {
    const body = await req.json();
    const { ticket_id, approver, action, comment, operation_token, approval_level, transfer_to } = body;

    if (!ticket_id || !approver || !action || !operation_token) {
      return NextResponse.json({ error: '缺少必填参数' }, { status: 400 });
    }

    // 获取工单当前状态
    const ticket = await conn.query('SELECT * FROM exception_tickets WHERE id = $1', [ticket_id]);
    if (ticket.rows.length === 0) {
      return NextResponse.json({ error: '工单不存在' }, { status: 404 });
    }
    const t = ticket.rows[0];

    // === 权限校验 ===

    // 1. 上报人不能审批自己的工单
    if (t.reported_by === approver) {
      return NextResponse.json({ error: '上报人不能审批自己提交的工单' }, { status: 403 });
    }

    // 2. 审批层级匹配校验
    if (action === 'approve' || action === 'reject') {
      if (approval_level === 'level1' && t.current_status !== 'level1_approving' && t.current_status !== 'pending_approval') {
        return NextResponse.json({ error: '该工单不在一级审批环节' }, { status: 403 });
      }
      if (approval_level === 'level2' && t.current_status !== 'level2_approving') {
        return NextResponse.json({ error: '该工单不在二级审批环节' }, { status: 403 });
      }
    }

    // === 幂等性校验 ===
    const existingOp = await conn.query(
      'SELECT id FROM approval_records WHERE ticket_id = $1 AND operation_token = $2',
      [ticket_id, operation_token]
    );
    if (existingOp.rows.length > 0) {
      return NextResponse.json({ warning: '该操作已处理，无需重复提交', alreadyProcessed: true });
    }

    await conn.query('BEGIN');

    try {
      let newStatus: string;

      if (action === 'approve') {
        // 读取配置判断是否需要二级审批
        const config = await conn.query(
          "SELECT config_value FROM approval_configs WHERE config_key = 'approval_level_thresholds'"
        );
        const thresholds = config.rows[0]?.config_value || { level1_max_amount: 5000 };
        const needLevel2 = parseFloat(t.amount) > (thresholds.level1_max_amount || 5000);

        if (approval_level === 'level1') {
          newStatus = needLevel2 ? 'level2_approving' : 'executing';
        } else {
          newStatus = 'executing';
        }
      } else if (action === 'reject') {
        // 拒绝：检查重提次数
        const config = await conn.query(
          "SELECT config_value FROM approval_configs WHERE config_key = 'reject_max_retries'"
        );
        const maxRetries = config.rows[0]?.config_value?.max_retries || 3;
        const newRejectCount = (t.reject_count || 0) + 1;

        if (newRejectCount >= maxRetries) {
          newStatus = 'closed';
        } else {
          newStatus = 'pending_approval';
        }

        await conn.query(
          'UPDATE exception_tickets SET reject_count = $1, updated_at = NOW() WHERE id = $2',
          [newRejectCount, ticket_id]
        );
      } else if (action === 'transfer') {
        if (!transfer_to) {
          await conn.query('ROLLBACK');
          return NextResponse.json({ error: '转交目标不能为空' }, { status: 400 });
        }
        newStatus = t.current_status;

        await conn.query(
          `INSERT INTO approval_records(id, ticket_id, approver, approval_level, action, comment, operation_token)
           VALUES($1, $2, $3, $4, 'transferred', $5, $6)`,
          [crypto.randomUUID(), ticket_id, approver, approval_level || 'level1',
           `转交给 ${transfer_to}: ${comment || ''}`, operation_token]
        );
        await conn.query('COMMIT');
        return NextResponse.json({ success: true, newStatus, transferred: true });
      } else {
        await conn.query('ROLLBACK');
        return NextResponse.json({ error: `不支持的操作: ${action}` }, { status: 400 });
      }

      // 乐观锁更新工单状态（version 字段防并发冲突）
      const updateResult = await conn.query(
        `UPDATE exception_tickets 
         SET current_status = $1, version = version + 1, updated_at = NOW()
         WHERE id = $2 AND version = $3`,
        [newStatus, ticket_id, t.version]
      );

      if (updateResult.rowCount === 0) {
        throw new Error('并发冲突：该工单已被其他审批人处理，请刷新后重试');
      }

      // 记录审批记录
      await conn.query(
        `INSERT INTO approval_records(id, ticket_id, approver, approval_level, action, comment, operation_token)
         VALUES($1, $2, $3, $4, $5, $6, $7)`,
        [crypto.randomUUID(), ticket_id, approver, approval_level || 'level1',
         action === 'approve' ? 'approved' : 'rejected', comment || null, operation_token]
      );

      await conn.query('COMMIT');

      // 如果进入执行中，触发执行联动
      if (newStatus === 'executing') {
        triggerExecution(ticket_id, t.source).catch(e => console.error('execution trigger failed:', e));
      }

      return NextResponse.json({ success: true, newStatus });
    } catch (err: any) {
      await conn.query('ROLLBACK');
      throw err;
    }
  } catch (error: any) {
    const status = error.message.includes('并发冲突') ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  } finally {
    conn.release();
  }
}

/**
 * 执行联动：审批通过后触发下游动作
 * 在同一个事务内完成状态变更 + 赔付记录生成 + 批次解锁
 */
async function triggerExecution(ticketId: string, source: string) {
  const { query } = await import('@/lib/db');

  const ticket = await query('SELECT * FROM exception_tickets WHERE id = $1', [ticketId]);
  if (ticket.rows.length === 0) return;
  const t = ticket.rows[0];

  if (source === 'scan') {
    // 品控异常：解锁批次 + 生成赔付（向供应商追偿）
    await query('BEGIN');
    try {
      await query("UPDATE scan_records SET batch_status = 'unlocked' WHERE ticket_id = $1", [ticketId]);

      if (['数量不符', '破损', '规格不符', '标签错误'].includes(t.exception_type)) {
        await query(
          `INSERT INTO compensation_records(id, ticket_id, compensation_direction, amount, status)
           VALUES($1, $2, 'to_supplier', $3, 'pending')`,
          [crypto.randomUUID(), ticketId, t.amount]
        );
      }

      await query("UPDATE exception_tickets SET current_status = 'completed', updated_at = NOW() WHERE id = $1", [ticketId]);
      await query('COMMIT');
    } catch (e) {
      await query('ROLLBACK');
      console.error('QC execution failed:', e);
    }
  } else {
    // 物流异常：生成赔付（赔客户）
    await query('BEGIN');
    try {
      if (['丢件', '破损'].includes(t.exception_type)) {
        await query(
          `INSERT INTO compensation_records(id, ticket_id, compensation_direction, amount, status)
           VALUES($1, $2, 'to_customer', $3, 'pending')`,
          [crypto.randomUUID(), ticketId, t.amount]
        );
      }

      await query("UPDATE exception_tickets SET current_status = 'completed', updated_at = NOW() WHERE id = $1", [ticketId]);
      await query('COMMIT');
    } catch (e) {
      await query('ROLLBACK');
      console.error('Logistics execution failed:', e);
    }
  }
}
