import { query } from '@/lib/db';
import type { QcRule } from '@/types';

export interface QcResult {
  passed: boolean;
  ruleId?: string;
  ruleName?: string;
  detail: string;
}

export class QCEngine {
  /**
   * 对扫描结果执行品控规则判定
   * 规则引擎执行过程可追溯（记录命中了哪条规则、判定依据）
   */
  static async evaluate(params: {
    skuCode: string;
    skuName: string;
    expectedQty: number;
    scannedQty: number;
    damageLevel?: number;
    specMatch?: boolean;
    batchNo?: string;
  }): Promise<QcResult> {
    const rules = await query<QcRule>('SELECT * FROM qc_rules WHERE enabled = true');

    for (const rule of rules.rows) {
      const conditions = rule.trigger_conditions;

      // 数量差异检测
      if (conditions.qty_diff_percent !== undefined && params.expectedQty > 0) {
        const diffPercent = Math.abs(params.scannedQty - params.expectedQty) / params.expectedQty * 100;
        if (diffPercent >= conditions.qty_diff_percent) {
          return {
            passed: false,
            ruleId: rule.id,
            ruleName: rule.name,
            detail: `数量差异 ${diffPercent.toFixed(1)}% (预期${params.expectedQty}, 实际${params.scannedQty}), 阈值 ${conditions.qty_diff_percent}%`,
          };
        }
      }

      // 破损等级检测
      if (conditions.damage_level !== undefined && (params.damageLevel || 0) >= conditions.damage_level) {
        return {
          passed: false,
          ruleId: rule.id,
          ruleName: rule.name,
          detail: `破损等级 ${params.damageLevel}, 阈值 ${conditions.damage_level}`,
        };
      }

      // 规格不符检测
      if (conditions.spec_mismatch && params.specMatch === false) {
        return {
          passed: false,
          ruleId: rule.id,
          ruleName: rule.name,
          detail: '规格不匹配',
        };
      }

      // 批次异常检测
      if (conditions.batch_check && params.batchNo === undefined) {
        return {
          passed: false,
          ruleId: rule.id,
          ruleName: rule.name,
          detail: '批次号缺失',
        };
      }
    }

    return { passed: true, detail: '品控检测通过' };
  }

  /**
   * 检查同一批次是否存在未关闭的品控工单（幂等性校验）
   * 同一批次同一 SKU 存在未关闭品控工单时，重复扫描只追加记录不新建工单
   */
  static async checkOpenTicket(waybillNo: string, skuCode: string, batchNo?: string): Promise<{ hasOpen: boolean; ticketId?: string }> {
    const r = await query(
      `SELECT sr.ticket_id, et.current_status 
       FROM scan_records sr
       JOIN exception_tickets et ON sr.ticket_id = et.id
       WHERE sr.waybill_no = $1 AND sr.sku_code = $2 
         AND ($3::varchar IS NULL OR sr.batch_no = $3)
         AND et.current_status NOT IN ('completed', 'closed')
       ORDER BY sr.scanned_at DESC LIMIT 1`,
      [waybillNo, skuCode, batchNo || null]
    );
    if (r.rows.length > 0) {
      return { hasOpen: true, ticketId: r.rows[0].ticket_id };
    }
    return { hasOpen: false };
  }
}
