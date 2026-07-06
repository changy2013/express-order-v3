import { Pool } from 'pg';

/**
 * 超时检查器 — 由 Vercel Cron Jobs 每 15 分钟触发
 *
 * 修复：使用专用连接池连接执行事务，避免在共享连接池上混用 BEGIN/COMMIT
 * 新增：品控暂扣超时检测（独立于审批超时，由仓储成本驱动）
 *
 * 处理逻辑：
 * - 待审批超时 → 升级二级审批
 * - 一级审批中超时 → 升级二级审批
 * - 二级审批中超时 → 自动关闭（自动驳回）
 * - 品控暂扣超时（batch_status='locked'）→ 工单强制升级二级审批
 */
export async function checkTimeouts() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const conn = await pool.connect();

  try {
    // 读取可配置超时参数（不硬编码）
    const configRes = await conn.query(
      "SELECT config_key, config_value FROM approval_configs WHERE config_key IN ('approval_timeout_hours', 'qc_hold_timeout_minutes') AND enabled = true"
    );
    const configMap: Record<string, any> = {};
    for (const row of configRes.rows) {
      configMap[row.config_key] = row.config_value;
    }

    const approvalTimeout = configMap.approval_timeout_hours || { level1: 48, level2: 24 };
    const qcHoldMinutes = configMap.qc_hold_timeout_minutes?.qc_hold || 120;
    const level1Hours = approvalTimeout.level1 || 48;
    const level2Hours = approvalTimeout.level2 || 24;

    let totalAffected = 0;
    const timestamp = new Date().toISOString();

    // ============================================================
    // 1. 审批工单超时自动流转
    // 使用显式事务，保证批量更新的原子性
    // ============================================================
    await conn.query('BEGIN');
    try {
      // 1a. 待审批超时 → 升级二级审批
      const r1 = await conn.query(
        `UPDATE exception_tickets 
         SET current_status = 'level2_approving', approval_level = 'level2', version = version + 1, updated_at = NOW()
         WHERE current_status = 'pending_approval' 
           AND updated_at < NOW() - INTERVAL '1 hour' * $1
           AND source = 'manual'`, // 品控工单（scan）已直接进入 level2，此处仅处理手工工单
        [level1Hours]
      );
      totalAffected += r1.rowCount || 0;

      // 1b. 一级审批中超时 → 升级二级审批
      const r2 = await conn.query(
        `UPDATE exception_tickets 
         SET current_status = 'level2_approving', approval_level = 'level2', version = version + 1, updated_at = NOW()
         WHERE current_status = 'level1_approving' 
           AND updated_at < NOW() - INTERVAL '1 hour' * $1`,
        [level1Hours]
      );
      totalAffected += r2.rowCount || 0;

      // 1c. 二级审批中超时 → 自动驳回关闭
      // 设计决策：二级超时选择自动关闭（而非继续升级）
      // 理由：已是最高审批层级，无法再升级；自动关闭让业务方重新评估后重新上报
      const r3 = await conn.query(
        `UPDATE exception_tickets 
         SET current_status = 'closed', version = version + 1, updated_at = NOW()
         WHERE current_status = 'level2_approving' 
           AND updated_at < NOW() - INTERVAL '1 hour' * $1`,
        [level2Hours]
      );
      totalAffected += r3.rowCount || 0;

      await conn.query('COMMIT');
    } catch (e) {
      await conn.query('ROLLBACK');
      console.error(`[${timestamp}] Approval timeout check ROLLBACK:`, e);
    }

    // ============================================================
    // 2. 品控暂扣超时自动处理（独立于审批超时）
    // 品控暂扣超时时长：120分钟（2小时）
    // 远短于审批超时（48小时），因为货物压仓每分钟都在产生运营成本
    // 超时后：强制将关联工单升级为二级审批，加快处理
    // ============================================================
    await conn.query('BEGIN');
    try {
      // 找出品控暂扣超时的工单（batch_status='locked' 且超过 qc_hold_timeout_minutes）
      const lockedBatches = await conn.query(
        `SELECT DISTINCT sr.ticket_id, et.current_status, et.version
         FROM scan_records sr
         JOIN exception_tickets et ON sr.ticket_id = et.id
         WHERE sr.batch_status = 'locked'
           AND sr.scanned_at < NOW() - INTERVAL '1 minute' * $1
           AND et.current_status NOT IN ('completed', 'closed', 'level2_approving')`,
        [qcHoldMinutes]
      );

      let qcAffected = 0;
      for (const row of lockedBatches.rows) {
        // 对每个超时工单，强制升级到二级审批
        const upd = await conn.query(
          `UPDATE exception_tickets 
           SET current_status = 'level2_approving', approval_level = 'level2', version = version + 1, updated_at = NOW()
           WHERE id = $1 AND version = $2 AND current_status NOT IN ('completed', 'closed', 'level2_approving')`,
          [row.ticket_id, row.version]
        );
        if ((upd.rowCount || 0) > 0) {
          qcAffected++;
          console.log(`[${timestamp}] QC hold timeout: ticket ${row.ticket_id} escalated to level2`);
        }
      }
      totalAffected += qcAffected;

      await conn.query('COMMIT');
    } catch (e) {
      await conn.query('ROLLBACK');
      console.error(`[${timestamp}] QC hold timeout check ROLLBACK:`, e);
    }

    console.log(`[${timestamp}] Timeout check completed. Affected: ${totalAffected} tickets`);
    return { timestamp, affected: totalAffected };
  } finally {
    conn.release();
    await pool.end();
  }
}
