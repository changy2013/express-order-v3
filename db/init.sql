-- ============================================================
-- V3 Schema: 运单全流程管理系统
-- ============================================================

-- 运单本地快照表
CREATE TABLE IF NOT EXISTS waybill_snapshots (
  id VARCHAR(36) PRIMARY KEY,
  waybill_no VARCHAR(100) NOT NULL UNIQUE,
  sender_name VARCHAR(255),
  sender_phone VARCHAR(50),
  sender_address TEXT,
  receiver_name VARCHAR(255),
  receiver_phone VARCHAR(50),
  receiver_address TEXT,
  total_amount DECIMAL(12,2) DEFAULT 0,
  sku_summary JSONB,
  status VARCHAR(50) DEFAULT 'active',
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ws_waybill_no ON waybill_snapshots(waybill_no);
CREATE INDEX IF NOT EXISTS idx_ws_synced_at ON waybill_snapshots(last_synced_at);

-- 接口同步日志表
CREATE TABLE IF NOT EXISTS sync_logs (
  id VARCHAR(36) PRIMARY KEY,
  request_id VARCHAR(36) NOT NULL,
  api_name VARCHAR(100) NOT NULL,
  request_params TEXT,
  response_status INTEGER,
  response_summary TEXT,
  duration_ms INTEGER,
  success BOOLEAN NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sl_request_id ON sync_logs(request_id);
CREATE INDEX IF NOT EXISTS idx_sl_created_at ON sync_logs(created_at DESC);

-- 审批配置表
CREATE TABLE IF NOT EXISTS approval_configs (
  id VARCHAR(36) PRIMARY KEY,
  config_key VARCHAR(100) NOT NULL UNIQUE,
  config_value JSONB NOT NULL,
  description TEXT,
  enabled BOOLEAN DEFAULT true,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 异常工单表
CREATE TABLE IF NOT EXISTS exception_tickets (
  id VARCHAR(36) PRIMARY KEY,
  ticket_no VARCHAR(50) NOT NULL UNIQUE,
  waybill_no VARCHAR(100) NOT NULL,
  source VARCHAR(20) NOT NULL CHECK (source IN ('scan', 'manual')),
  exception_type VARCHAR(50) NOT NULL,
  exception_subtype VARCHAR(50),
  severity VARCHAR(20) DEFAULT 'medium',
  description TEXT,
  reported_by VARCHAR(100) NOT NULL,
  reported_at TIMESTAMPTZ DEFAULT NOW(),
  current_status VARCHAR(50) NOT NULL DEFAULT 'pending_approval',
  amount DECIMAL(12,2) DEFAULT 0,
  approval_level VARCHAR(20),
  reject_count INTEGER DEFAULT 0,
  max_reject_limit INTEGER DEFAULT 3,
  linked_ticket_id VARCHAR(36),
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_et_waybill_no ON exception_tickets(waybill_no);
CREATE INDEX IF NOT EXISTS idx_et_status ON exception_tickets(current_status);
CREATE INDEX IF NOT EXISTS idx_et_reported_by ON exception_tickets(reported_by);
CREATE INDEX IF NOT EXISTS idx_et_source ON exception_tickets(source);

-- 品控规则表
CREATE TABLE IF NOT EXISTS qc_rules (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  exception_type VARCHAR(50) NOT NULL,
  trigger_conditions JSONB NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'medium',
  auto_create_ticket BOOLEAN DEFAULT true,
  target_approval_level VARCHAR(20) DEFAULT 'level1',
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 扫描记录表
CREATE TABLE IF NOT EXISTS scan_records (
  id VARCHAR(36) PRIMARY KEY,
  waybill_no VARCHAR(100) NOT NULL,
  sku_code VARCHAR(100) NOT NULL,
  sku_name VARCHAR(255),
  batch_no VARCHAR(100),
  operator VARCHAR(100) NOT NULL,
  scanned_at TIMESTAMPTZ DEFAULT NOW(),
  qc_result VARCHAR(20) NOT NULL CHECK (qc_result IN ('pass', 'fail')),
  qc_rule_id VARCHAR(36),
  qc_rule_detail TEXT,
  batch_status VARCHAR(50) DEFAULT 'normal',
  ticket_id VARCHAR(36),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sr_waybill ON scan_records(waybill_no);
CREATE INDEX IF NOT EXISTS idx_sr_ticket ON scan_records(ticket_id);
CREATE INDEX IF NOT EXISTS idx_sr_batch ON scan_records(waybill_no, sku_code, batch_no);

-- 审批记录表
CREATE TABLE IF NOT EXISTS approval_records (
  id VARCHAR(36) PRIMARY KEY,
  ticket_id VARCHAR(36) NOT NULL REFERENCES exception_tickets(id),
  approver VARCHAR(100) NOT NULL,
  approval_level VARCHAR(20) NOT NULL,
  action VARCHAR(20) NOT NULL,
  comment TEXT,
  operation_token VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_approval_token UNIQUE (ticket_id, operation_token)
);
CREATE INDEX IF NOT EXISTS idx_ar_ticket ON approval_records(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ar_approver ON approval_records(approver);

-- 赔付记录表
CREATE TABLE IF NOT EXISTS compensation_records (
  id VARCHAR(36) PRIMARY KEY,
  ticket_id VARCHAR(36) NOT NULL REFERENCES exception_tickets(id),
  approval_record_id VARCHAR(36),
  compensation_direction VARCHAR(20) NOT NULL CHECK (compensation_direction IN ('to_customer', 'to_supplier')),
  amount DECIMAL(12,2) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending',
  settlement_method VARCHAR(100),
  remark TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cr_ticket ON compensation_records(ticket_id);
CREATE INDEX IF NOT EXISTS idx_cr_direction ON compensation_records(compensation_direction);

-- 库存表
CREATE TABLE IF NOT EXISTS inventory (
  id VARCHAR(36) PRIMARY KEY,
  sku_code VARCHAR(100) NOT NULL,
  sku_name VARCHAR(255) NOT NULL,
  warehouse VARCHAR(100) DEFAULT 'default',
  total_qty INTEGER NOT NULL DEFAULT 0,
  locked_qty INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_inventory_sku_warehouse UNIQUE (sku_code, warehouse)
);
CREATE INDEX IF NOT EXISTS idx_inv_sku ON inventory(sku_code);

-- 库存变动日志表（可追溯性：记录每次变动由哪条审批记录触发）
CREATE TABLE IF NOT EXISTS inventory_logs (
  id VARCHAR(36) PRIMARY KEY,
  sku_code VARCHAR(100) NOT NULL,
  warehouse VARCHAR(100) DEFAULT 'default',
  change_type VARCHAR(50) NOT NULL CHECK (change_type IN ('lock', 'unlock', 'deduct', 'add', 'adjust')),
  qty_change INTEGER NOT NULL,
  qty_before INTEGER NOT NULL,
  qty_after INTEGER NOT NULL,
  reason TEXT,
  ticket_id VARCHAR(36),
  approval_record_id VARCHAR(36),
  operator VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_il_sku ON inventory_logs(sku_code);
CREATE INDEX IF NOT EXISTS idx_il_ticket ON inventory_logs(ticket_id);
CREATE INDEX IF NOT EXISTS idx_il_approval ON inventory_logs(approval_record_id);
CREATE INDEX IF NOT EXISTS idx_il_created ON inventory_logs(created_at DESC);

-- ============================================================
-- 初始配置数据
-- ============================================================
INSERT INTO approval_configs (id, config_key, config_value, description) VALUES
  (gen_random_uuid()::varchar, 'approval_level_thresholds', '{"level1_max_amount": 5000, "level2_min_amount": 5000.01}', '分级审批金额阈值（元）：5000元以下一级审批，5000元及以上需二级审批'),
  (gen_random_uuid()::varchar, 'approval_timeout_hours', '{"level1": 48, "level2": 24}', '审批超时时长（小时）：一级48小时，二级24小时，超时自动升级'),
  (gen_random_uuid()::varchar, 'qc_hold_timeout_minutes', '{"qc_hold": 120}', '品控暂扣超时时长（分钟）：2小时，独立于审批超时，货物压仓成本驱动'),
  (gen_random_uuid()::varchar, 'reject_max_retries', '{"max_retries": 3}', '拒绝重提次数上限：3次，超出后自动关闭工单')
ON CONFLICT (config_key) DO NOTHING;

-- 品控规则初始数据（可配置，非硬编码）
INSERT INTO qc_rules (id, name, description, exception_type, trigger_conditions, severity, auto_create_ticket, target_approval_level, enabled) VALUES
  (gen_random_uuid()::varchar, '数量差异检测', '扫描数量与预期数量差异超过10%触发', '数量不符',
   '{"qty_diff_percent": 10}', 'high', true, 'level2', true),
  (gen_random_uuid()::varchar, '破损等级检测', '破损等级达到2级及以上触发（0=无损，5=完全损毁）', '外观破损',
   '{"damage_level": 2}', 'high', true, 'level2', true),
  (gen_random_uuid()::varchar, '规格不符检测', '货物规格与运单不匹配触发', '规格不符',
   '{"spec_mismatch": true}', 'medium', true, 'level1', true),
  (gen_random_uuid()::varchar, '批次号缺失检测', '扫描时未提供批次号触发', '批次异常',
   '{"batch_check": true}', 'low', true, 'level1', true)
ON CONFLICT DO NOTHING;
