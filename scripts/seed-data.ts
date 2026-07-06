/**
 * 种子数据生成脚本
 * 生成 220 条模拟异常工单，覆盖不同状态、不同类型
 * 运行: npx ts-node scripts/seed-data.ts
 */
import { query } from '../src/lib/db';

async function seed() {
  console.log('Generating 220 mock exception tickets...');

  const logisticsTypes = ['丢件', '破损', '客户拒收', '超时未签收', '收货地址错误'];
  const qcTypes = ['数量不符', '外观破损', '规格不符', '标签错误', '批次异常'];
  const types = [...logisticsTypes, ...qcTypes];
  const sources: ('manual' | 'scan')[] = ['manual', 'manual', 'manual', 'scan', 'scan']; // 60% manual, 40% scan
  const statuses = ['pending_approval', 'level1_approving', 'level2_approving', 'executing', 'completed', 'closed'];
  const reporters = ['张三', '李四', '王五', '赵六', '仓库管理员', '质检员'];
  const operators = ['仓库管理员', '质检员', '扫描员'];

  let count = 0;
  for (let i = 0; i < 220; i++) {
    const id = crypto.randomUUID();
    const ticketNo = `SEED${String(i + 1).padStart(4, '0')}`;
    const waybillNo = `WB${String(20260000 + i)}`;
    const source = sources[Math.floor(Math.random() * sources.length)];
    const type = types[Math.floor(Math.random() * types.length)];
    const status = statuses[Math.floor(Math.random() * statuses.length)];
    const amount = Math.round(Math.random() * 10000 * 100) / 100;
    const reportedBy = reporters[Math.floor(Math.random() * reporters.length)];
    const rejectCount = status === 'closed' ? 3 : Math.floor(Math.random() * 3);
    const severity = ['low', 'medium', 'high', 'critical'][Math.floor(Math.random() * 4)];

    const daysAgo = Math.floor(Math.random() * 30);
    const hoursAgo = Math.floor(Math.random() * 24);

    try {
      await query(
        `INSERT INTO exception_tickets(id, ticket_no, waybill_no, source, exception_type, severity, description, reported_by, current_status, amount, reject_count, created_at, updated_at)
         VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 
                NOW() - INTERVAL '1 day' * $12 - INTERVAL '1 hour' * $13,
                NOW() - INTERVAL '1 hour' * $14)`,
        [id, ticketNo, waybillNo, source, type, severity, `模拟数据 - ${type}异常`, reportedBy, status, amount, rejectCount,
         daysAgo, hoursAgo, Math.floor(Math.random() * 24)]
      );

      // 为已审批的工单添加审批记录和赔付记录
      if (status === 'completed' || status === 'closed' || status === 'level2_approving' || status === 'executing') {
        await query(
          `INSERT INTO approval_records(id, ticket_id, approver, approval_level, action, comment, operation_token, created_at)
           VALUES($1, $2, $3, 'level1', 'approved', '审批通过', $4, NOW() - INTERVAL '1 day')`,
          [crypto.randomUUID(), id, 'level1_approver', crypto.randomUUID()]
        );

        // 部分工单添加赔付记录
        if (status === 'completed' && (type === '丢件' || type === '破损')) {
          await query(
            `INSERT INTO compensation_records(id, ticket_id, compensation_direction, amount, status, created_at)
             VALUES($1, $2, $3, $4, 'completed', NOW() - INTERVAL '12 hours')`,
            [crypto.randomUUID(), id, source === 'scan' ? 'to_supplier' : 'to_customer', amount]
          );
        }
      }

      // 为扫描类异常添加扫描记录
      if (source === 'scan') {
        await query(
          `INSERT INTO scan_records(id, waybill_no, sku_code, sku_name, operator, qc_result, batch_status, ticket_id, scanned_at)
           VALUES($1, $2, $3, $4, $5, $6, $7, $8, NOW() - INTERVAL '1 day' * $9)`,
          [crypto.randomUUID(), waybillNo, `SKU${String(1000 + i)}`, `商品${String.fromCharCode(65 + (i % 26))}`, 
           operators[Math.floor(Math.random() * operators.length)],
           status === 'completed' ? 'pass' : 'fail',
           status === 'completed' ? 'normal' : 'locked',
           id, daysAgo]
        );
      }

      count++;
      if (count % 50 === 0) console.log(`  ... ${count} tickets created`);
    } catch (e: any) {
      // 跳过重复等错误
      if (!e.message.includes('duplicate')) {
        console.error(`Error creating ticket ${i}:`, e.message);
      }
    }
  }

  console.log(`\n✅ Seed data created: ${count} exception tickets`);
  console.log('Run `npm run dev` and check /api/tickets to verify.');
}

seed().catch(console.error);
