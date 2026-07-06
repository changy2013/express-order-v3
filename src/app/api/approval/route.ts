import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * 物流异常类型 → 库存动作映射
 * 设计依据（详见 docs/assumptions.md 第④项）：
 * - 丢件/破损：货物已损失，减少库存总量
 * - 客户拒收：货物退回入库，增加库存
 * - 超时未签收：货物仍在途，库存不变，仅赔付
 * - 收货地址错误：重新发货，库存不变，无赔付
 */
const LOGISTICS_ACTION_MAP: Record<string, {
  inventoryChange: 'deduct' | 'add' | 'none';
  generateCompensation: boolean;
  compensationDirection: 'to_customer' | 'to_supplier' | null;
}> = {
  '丢件':       { inventoryChange: 'deduct', generateCompensation: true,  compensationDirection: 'to_customer' },
  '破损':       { inventoryChange: 'deduct', generateCompensation: true,  compensationDirection: 'to_customer' },
  '客户拒收':   { inventoryChange: 'add',    generateCompensation: false, compensationDirection: null },
  '超时未签收': { inventoryChange: 'none',   generateCompensation: true,  compensationDirection: 'to_customer' },
  '收货地址错误':{ inventoryChange: 'none',  generateCompensation: false, compensationDirection: null },
};

/**
 * 品控异常类型 → 库存动作映射
 * 品控异常赔付方向均为向供应商追偿
 */
const QC_ACTION_MAP: Record<string, {
  inventoryChange: 'deduct' | 'none';
  generateCompensation: boolean;
}> = {
  '数量不符':  { inventoryChange: 'deduct', generateCompensation: true },
  '外观破损':  { inventoryChange: 'deduct', generateCompensation: true },
  '规格不符':  { inventoryChange: 'deduct', generateCompensation: true },
  '标签错误':  { inventoryChange: 'none',   generateCompensation: false }, // 重新标签后出库，无追偿
  '批次异常':  { inventoryChange: 'deduct', generateCompensation: true },
};

/**
 * POST /api/approval
 * 审批操作：通过/拒绝/转交
 *
 * Body:
 * - ticket_id: 工单 ID
 * - approver: 审批人标识
 * - approver_role: 'level1_approver' | 'level2_approver' | 'admin'
 * - action: 'approve' | 'reject' | 'transfer'
 * - comment: 审批意见
 * - operation_token: 幂等令牌（前端生成 UUID）
 * - approval_level: 'level1' | 'level2'
 * - transfer_to: 转交目标（仅 transfer 时）
 */
export async function POST(req: NextRequest) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const conn = await pool.connect();

  try {
    const body = await req.json();
    const { ticket_id, approver, approver_role, action, comment, operation_token, approval_level, transfer_to } = body;

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

    // 1. 上报人不能审批自己的工单（防自批自核）
    if (t.reported_by === approver) {
      return NextResponse.json({ error: '上报人不能审批自己提交的工单' }, { status: 403 });
    }

    // 2. 角色与审批层级匹配校验（后端强校验，前端隐藏入口不算数）
    if (action === 'approve' || action === 'reject') {
      if (approval_level === 'level1') {
        // 一级审批人：只能处理 level1_approving 或 pending_approval 状态
        if (approver_role && approver_role !== 'level1_approver' && approver_role !== 'admin') {
          return NextResponse.json({ error: '无权限：一级审批需要 level1_approver 角色' }, { status: 403 });
        }
        if (t.current_status !== 'level1_approving' && t.current_status !== 'pending_approval') {
          return NextResponse.json({ error: '该工单不在一级审批环节' }, { status: 403 });
        }
      }
      if (approval_level === 'level2') {
        // 二级审批人：只能处理 level2_approving 状态
        if (approver_role && approver_role !== 'level2_approver' && approver_role !== 'admin') {
          return NextResponse.json({ error: '无权限：二级审批需要 level2_approver 角色' }, { status: 403 });
        }
        if (t.current_status !== 'level2_approving') {
          return NextResponse.json({ error: '该工单不在二级审批环节' }, { status: 403 });
        }
      }
    }

    // === 幂等性校验（基于 operation_token 唯一约束）===
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
      const approvalRecordId = crypto.randomUUID();

      if (action === 'approve') {
        // 读取可配置阈值（不硬编码）
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
        // 拒绝：检查可配置重提次数上限
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
          [approvalRecordId, ticket_id, approver, approval_level || 'level1',
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

      // 记录审批记录（含唯一 ID，用于赔付/库存可追溯）
      await conn.query(
        `INSERT INTO approval_records(id, ticket_id, approver, approval_level, action, comment, operation_token)
         VALUES($1, $2, $3, $4, $5, $6, $7)`,
        [approvalRecordId, ticket_id, approver, approval_level || 'level1',
         action === 'approve' ? 'approved' : 'rejected', comment || null, operation_token]
      );

      // ============================================================
      // 执行联动（在同一事务内完成，保证原子性，防止中间态）
      // 审批通过且进入 executing 状态时，触发下游动作
      // ============================================================
      if (newStatus === 'executing') {
        await executeInTransaction(conn, t, approvalRecordId);
        // 执行完成后直接推进到 completed 状态
        await conn.query(
          "UPDATE exception_tickets SET current_status = 'completed', updated_at = NOW() WHERE id = $1",
          [ticket_id]
        );
      }

      await conn.query('COMMIT');

      return NextResponse.json({ success: true, newStatus: newStatus === 'executing' ? 'completed' : newStatus });
    } catch (err: any) {
      await conn.query('ROLLBACK');
      throw err;
    }
  } catch (error: any) {
    const status = error.message.includes('并发冲突') ? 409 : 500;
    return NextResponse.json({ error: error.message }, { status });
  } finally {
    conn.release();
    await pool.end();
  }
}

async function getQcReleaseContext(conn: any, ticketId: string) {
  const scanRec = await conn.query(
    'SELECT sku_code FROM scan_records WHERE ticket_id = $1 ORDER BY scanned_at LIMIT 1',
    [ticketId]
  );
  const skuCode = scanRec.rows[0]?.sku_code;
  if (!skuCode) return null;

  const lockLog = await conn.query(
    `SELECT COALESCE(SUM(qty_change), 0) AS locked_qty
     FROM inventory_logs
     WHERE ticket_id = $1 AND change_type = 'lock'`,
    [ticketId]
  );
  const releaseQty = Number(lockLog.rows[0]?.locked_qty || 0);

  return { skuCode, releaseQty };
}

async function releaseQcInventoryLock(
  conn: any,
  params: {
    ticketId: string;
    approvalRecordId?: string;
    reason: string;
  }
) {
  const releaseContext = await getQcReleaseContext(conn, params.ticketId);
  if (!releaseContext?.skuCode || releaseContext.releaseQty <= 0) {
    return null;
  }

  const inv = await conn.query(
    "SELECT id, total_qty, locked_qty FROM inventory WHERE sku_code = $1 AND warehouse = 'default'",
    [releaseContext.skuCode]
  );
  if (inv.rows.length === 0) {
    return null;
  }

  const { id: invId, total_qty, locked_qty } = inv.rows[0];
  const actualReleaseQty = Math.min(Number(locked_qty || 0), releaseContext.releaseQty);
  if (actualReleaseQty <= 0) {
    return null;
  }

  const newLocked = Math.max(0, Number(locked_qty || 0) - actualReleaseQty);
  await conn.query(
    'UPDATE inventory SET locked_qty = $1, updated_at = NOW() WHERE id = $2',
    [newLocked, invId]
  );

  await conn.query(
    `INSERT INTO inventory_logs(id, sku_code, change_type, qty_change, qty_before, qty_after, reason, ticket_id, approval_record_id)
     VALUES($1, $2, 'unlock', $3, $4, $5, $6, $7, $8)`,
    [
      crypto.randomUUID(),
      releaseContext.skuCode,
      -actualReleaseQty,
      locked_qty,
      newLocked,
      params.reason,
      params.ticketId,
      params.approvalRecordId || null,
    ]
  );

  return {
    skuCode: releaseContext.skuCode,
    actualReleaseQty,
    totalQty: Number(total_qty || 0),
    lockedQty: Number(locked_qty || 0),
    newLocked,
  };
}

/**
 * 在事务连接内执行联动动作（库存 + 赔付 + 批次解锁）
 * 必须在同一事务内完成，任何步骤失败均回滚，防止中间态
 */
async function executeInTransaction(
  conn: any,
  ticket: any,
  approvalRecordId: string
) {
  const { id: ticketId, source, exception_type: exceptionType, amount, waybill_no: waybillNo } = ticket;

  if (source === 'scan') {
    // ============================================================
    // 品控异常执行联动
    // 赔付方向：向供应商追偿
    // ============================================================
    const qcAction = QC_ACTION_MAP[exceptionType] || { inventoryChange: 'none', generateCompensation: false };

    // 1. 解锁品控暂扣批次（在同一事务内，与工单完成状态同步）
    await conn.query(
      "UPDATE scan_records SET batch_status = 'unlocked' WHERE ticket_id = $1",
      [ticketId]
    );

    // 2. 统一释放库存锁，避免批次已解锁但 locked_qty 残留
    const released = await releaseQcInventoryLock(conn, {
      ticketId,
      approvalRecordId,
      reason: `品控工单完成解锁：${exceptionType}`,
    });

    // 3. 库存变动（针对报废/损耗类品控异常）
    if (qcAction.inventoryChange === 'deduct' && released) {
      const newTotal = Math.max(0, released.totalQty - released.actualReleaseQty);

      await conn.query(
        'UPDATE inventory SET total_qty = $1, updated_at = NOW() WHERE sku_code = $2 AND warehouse = $3',
        [newTotal, released.skuCode, 'default']
      );

      await conn.query(
        `INSERT INTO inventory_logs(id, sku_code, change_type, qty_change, qty_before, qty_after, reason, ticket_id, approval_record_id)
         VALUES($1, $2, 'deduct', $3, $4, $5, $6, $7, $8)`,
        [crypto.randomUUID(), released.skuCode, -released.actualReleaseQty, released.totalQty, newTotal,
         `品控异常-${exceptionType}：货物报废/损耗`, ticketId, approvalRecordId]
      );
    }

    // 4. 生成赔付记录（向供应商追偿，关联 approval_record_id 保证可追溯）
    if (qcAction.generateCompensation && parseFloat(amount) > 0) {
      await conn.query(
        `INSERT INTO compensation_records(id, ticket_id, approval_record_id, compensation_direction, amount, status, remark)
         VALUES($1, $2, $3, 'to_supplier', $4, 'pending', $5)`,
        [crypto.randomUUID(), ticketId, approvalRecordId, amount,
         `品控异常-${exceptionType}：向供应商追偿`]
      );
    }

  } else {
    // ============================================================
    // 物流异常执行联动
    // 赔付方向：赔付给客户
    // ============================================================
    const logAction = LOGISTICS_ACTION_MAP[exceptionType] || { inventoryChange: 'none', generateCompensation: false, compensationDirection: null };

    // 库存联动（按异常类型映射）
    if (logAction.inventoryChange !== 'none') {
      // 从快照表获取 SKU 信息
      const snapshot = await conn.query(
        'SELECT sku_summary FROM waybill_snapshots WHERE waybill_no = $1',
        [waybillNo]
      );
      const skuSummary = snapshot.rows[0]?.sku_summary || [];

      for (const sku of skuSummary) {
        if (!sku.sku_code) continue;
        const inv = await conn.query(
          "SELECT id, total_qty, locked_qty FROM inventory WHERE sku_code = $1 AND warehouse = 'default'",
          [sku.sku_code]
        );

        if (inv.rows.length > 0) {
          const { id: invId, total_qty } = inv.rows[0];
          let newTotal = total_qty;
          let changeType: string;
          let qtyChange: number;

          if (logAction.inventoryChange === 'deduct') {
            // 丢件/破损：减少总库存
            qtyChange = -(sku.quantity || 1);
            newTotal = Math.max(0, total_qty + qtyChange);
            changeType = 'deduct';
          } else {
            // 客户拒收：退回入库，增加总库存
            qtyChange = sku.quantity || 1;
            newTotal = total_qty + qtyChange;
            changeType = 'add';
          }

          await conn.query(
            'UPDATE inventory SET total_qty = $1, updated_at = NOW() WHERE id = $2',
            [newTotal, invId]
          );

          await conn.query(
            `INSERT INTO inventory_logs(id, sku_code, change_type, qty_change, qty_before, qty_after, reason, ticket_id, approval_record_id)
             VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [crypto.randomUUID(), sku.sku_code, changeType, qtyChange, total_qty, newTotal,
             `物流异常-${exceptionType}`, ticketId, approvalRecordId]
          );
        }
      }
    }

    // 生成赔付记录（关联 approval_record_id）
    if (logAction.generateCompensation && logAction.compensationDirection && parseFloat(amount) > 0) {
      await conn.query(
        `INSERT INTO compensation_records(id, ticket_id, approval_record_id, compensation_direction, amount, status, remark)
         VALUES($1, $2, $3, $4, $5, 'pending', $6)`,
        [crypto.randomUUID(), ticketId, approvalRecordId, logAction.compensationDirection, amount,
         `物流异常-${exceptionType}：${logAction.compensationDirection === 'to_customer' ? '赔付给客户' : '向供应商追偿'}`]
      );
    }
  }
}
