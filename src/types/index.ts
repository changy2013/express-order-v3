// ============================================================
// V3 类型定义
// ============================================================

/** 运单本地快照 */
export interface WaybillSnapshot {
  id: string;
  waybill_no: string;
  sender_name?: string;
  sender_phone?: string;
  sender_address?: string;
  receiver_name?: string;
  receiver_phone?: string;
  receiver_address?: string;
  total_amount: number;
  sku_summary?: SkuItem[];
  status: string;
  last_synced_at: string;
  created_at: string;
}

/** SKU 明细项 */
export interface SkuItem {
  sku_code: string;
  sku_name: string;
  quantity: number;
}

/** 接口同步日志 */
export interface SyncLog {
  id: string;
  request_id: string;
  api_name: string;
  request_params?: string;
  response_status?: number;
  response_summary?: string;
  duration_ms?: number;
  success: boolean;
  error_message?: string;
  created_at: string;
}

/** 异常工单 */
export interface ExceptionTicket {
  id: string;
  ticket_no: string;
  waybill_no: string;
  source: 'scan' | 'manual';
  exception_type: string;
  exception_subtype?: string;
  severity: string;
  description?: string;
  reported_by: string;
  reported_at: string;
  current_status: string;
  amount: number;
  approval_level?: string;
  reject_count: number;
  max_reject_limit: number;
  linked_ticket_id?: string;
  version: number;
  created_at: string;
  updated_at: string;
}

/** 扫描记录 */
export interface ScanRecord {
  id: string;
  waybill_no: string;
  sku_code: string;
  sku_name?: string;
  batch_no?: string;
  operator: string;
  scanned_at: string;
  qc_result: 'pass' | 'fail';
  qc_rule_id?: string;
  qc_rule_detail?: string;
  batch_status: string;
  ticket_id?: string;
}

/** 品控规则 */
export interface QcRule {
  id: string;
  name: string;
  description?: string;
  exception_type: string;
  trigger_conditions: Record<string, any>;
  severity: string;
  auto_create_ticket: boolean;
  target_approval_level: string;
  enabled: boolean;
}

/** 审批记录 */
export interface ApprovalRecord {
  id: string;
  ticket_id: string;
  approver: string;
  approval_level: string;
  action: 'approved' | 'rejected' | 'escalated' | 'transferred';
  comment?: string;
  operation_token: string;
  created_at: string;
}

/** 赔付记录 */
export interface CompensationRecord {
  id: string;
  ticket_id: string;
  approval_record_id?: string;
  compensation_direction: 'to_customer' | 'to_supplier';
  amount: number;
  status: string;
  settlement_method?: string;
  remark?: string;
}

/** 库存 */
export interface Inventory {
  id: string;
  sku_code: string;
  sku_name: string;
  warehouse: string;
  total_qty: number;
  locked_qty: number;
  available_qty: number;
}

/** 审批配置 */
export interface ApprovalConfig {
  id: string;
  config_key: string;
  config_value: Record<string, any>;
  description?: string;
  enabled: boolean;
}

// ============================================================
// V2 API 响应类型
// ============================================================

/** V2 运单详情 */
export interface V2WaybillDetail {
  waybill_no: string;
  sender_name?: string;
  sender_phone?: string;
  sender_address?: string;
  receiver_name?: string;
  receiver_phone?: string;
  receiver_address?: string;
  total_amount: number;
  status: string;
  sku_items: SkuItem[];
  updated_at: string;
}

/** V2 SKU 校验结果 */
export interface V2SkuVerifyResult {
  exists: boolean;
  sku_code: string;
  sku_name?: string;
  quantity?: number;
  waybill_no: string;
}

/** V2 运单列表响应 */
export interface V2WaybillListResponse {
  groups: Array<{
    '外部编码': string;
    '收货门店'?: string;
    '收件人姓名'?: string;
    '收件人电话'?: string;
    '收件人地址'?: string;
    sku_count: number;
    total_amount?: string;
    created_at: string;
  }>;
  total: number;
  page: number;
  pageSize: number;
}
