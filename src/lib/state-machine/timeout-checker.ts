import { query } from '@/lib/db';

/**
 * 扫描超时工单并自动处理
 * 适合通过 Vercel Cron Jobs 每 15 分钟调用一次
 * 逻辑：
 * - 待审批超时 → 自动升级二级审批
 * - 一级审批中超时 → 自动升级二级审批
 * - 二级审批中超时 → 自动关闭
 */
export async function checkTimeouts() {
  const configs = await query("SELECT config_key, config_value FROM approval_configs WHERE enabled = true");
  const configMap: Record<string, any> = {};
  for (const row of configs.rows) {
    configMap[row.config_key] = row.config_value;
  }

  const approvalTimeout = configMap.approval_timeout_hours || { level1: 48, level2: 24 };
  const level1Hours = approvalTimeout.level1 || 48;
  const level2Hours = approvalTimeout.level2 || 24;

  let totalAffected = 0;

  // 1. 待审批超时 → 升级二级审批
  const r1 = await query(
    `UPDATE exception_tickets 
     SET current_status = 'level2_approving', approval_level = 'level2', version = version + 1, updated_at = NOW()
     WHERE current_status = 'pending_approval' 
       AND created_at < NOW() - INTERVAL '1 hour' * $1`,
    [level1Hours]
  );
  totalAffected += r1.rowCount || 0;

  // 2. 一级审批中超时 → 升级二级审批
  const r2 = await query(
    `UPDATE exception_tickets 
     SET current_status = 'level2_approving', approval_level = 'level2', version = version + 1, updated_at = NOW()
     WHERE current_status = 'level1_approving' 
       AND updated_at < NOW() - INTERVAL '1 hour' * $1`,
    [level1Hours]
  );
  totalAffected += r2.rowCount || 0;

  // 3. 二级审批中超时 → 自动关闭
  const r3 = await query(
    `UPDATE exception_tickets 
     SET current_status = 'closed', version = version + 1, updated_at = NOW()
     WHERE current_status = 'level2_approving' 
       AND updated_at < NOW() - INTERVAL '1 hour' * $1`,
    [level2Hours]
  );
  totalAffected += r3.rowCount || 0;

  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Timeout check completed. Affected: ${totalAffected} tickets`);
  return { timestamp, affected: totalAffected };
}
