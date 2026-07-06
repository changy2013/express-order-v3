# 架构决策与假设记录

> 本文档记录 Express Order V3 在设计与实现过程中所做的架构决策、未竟事宜（open items）及对应的假设。

---

## 1. 系统边界

### 1.1 V2 vs V3 分离

| 项目 | 决策 |
|------|------|
| 数据库 | 独立 Neon 数据库，不与 V2 共享 |
| 接口 | 仅通过 HTTP API 调用 V2，无直接 DB 访问 |
| 部署 | 独立的 Vercel 项目 |

**理由**：需求明确要求 V3 为独立部署系统，评分标准中"跨系统接口"为重要维度。

### 1.2 数据同步策略

- 运单数据 **按需拉取**（query on demand），不做全量同步
- `/api/sync-logs` 记录每次调用供审计
- V2 不可用时降级为本地快照（`getLocalWaybill`），但标注数据"可能过期"

---

## 2. 状态机设计

### 2.1 异常工单状态机

```
pending_approval → level1_approving → level2_approving → executing → completed
                                                                   ↘ closed
pending_approval → executing (直接处理)
```

- **rejected** 回退到 `level1_approving`（重新审批）
- **reopened** 从 `completed`/`closed` → `pending_approval`
- 共 11 条合法转换边，每条转换有守卫条件

### 2.2 扫描批次状态机

```
normal → locked (QC 发现异常)
locked → normal (批准后自动释放 / 手动快速释放)
```

---

## 3. 审批规则

### 3.1 规则可配置

规则存入 `approval_configs` 表，运行时加载（不硬编码）：

```json
{
  "severity": "high",
  "min_level": "level1",
  "max_amount": 5000,
  "required_roles": ["仓储主管"]
}
```

### 3.2 自审批禁止

如果是自己的工单，`reported_by === approver` → HTTP 403，前端隐藏"审批"按钮。

---

## 4. Open Items（假设与待确认）

### 4.1 审批层级映射规则

**假设**：`approval_configs.severity` + `amount` 决定审批层级。具体映射：

| 严重程度 | 金额 | 所需审批层级 |
|---------|------|------------|
| low | 任意 | level1 |
| medium | ≤1000 | level1 |
| medium | >1000 | level2 |
| high | 任意 | level2 |
| critical | 任意 | level2（需额外上报） |

**open item**：实际业务中是否需支持更多层级（如 level3 总监审批）？当前状态机预留了扩展点但未实现。

### 4.2 超时阈值

**假设**：
- QC 暂存超时：2 小时（仓储成本驱动）
- 审批超时：48 小时（普通）/ 24 小时（紧急）

**open item**：阈值是否需要可配置？当前硬编码在 `timeout-checker.ts` 中。

### 4.3 审批通过后的执行联动

**当前实现**：在 `approval` API 的同一个数据库事务中：
1. 更新工单状态 → `executing`
2. 插入 `compensation_records`
3. 更新 `scan_records.batch_status` → `normal`（释放批次锁）

**open item**：是否需要异步执行？对于复杂场景（如调用外部财务系统），事务内执行可能阻塞过久。

### 4.4 QC 规则更新频率

**假设**：QC 规则变更不频繁，当前用文件存储（`qc-engine/rules.ts`），重启后生效。

**open item**：是否需要运行时热更新？若需动态规则，需改为数据库存储。

### 4.5 乐观锁冲突策略

**当前实现**：`version` 字段 + `UPDATE ... WHERE version = :current`，失败返回 409。

**open item**：冲突后的用户体验？当前返回 JSON 错误，前端可提示用户刷新重试。

### 4.6 幂等性保障

**当前实现**：`operation_token` 唯一约束，重复请求静默忽略。

**open item**：token 的生成策略？当前由前端生成 UUID，理论上由后端生成更安全。

### 4.7 数据保留策略

**假设**：sync_logs / scan_records 保留 90 天。

**open item**：是否需要定期清理？（未实现定时清理）

### 4.8 通知机制

**假设**：审批人通过定期查看"待审批列表"获取任务。

**open item**：是否需要主动通知（钉钉/邮件/站内信）？当前未实现。

### 4.9 多仓库支持

**假设**：系统当前为单仓库模式。

**open item**：若需多仓库，需在所有表加 `warehouse_id` 字段，并修改 API 查询条件。

---

## 5. 安全假设

| 假设 | 说明 |
|------|------|
| 认证 | V3 运行在企业内网或 Vercel 授权访问，未实现用户登录 |
| 角色 | 通过 `x-user-role` / `x-user-id` 请求头模拟 |
| 数据隔离 | 当前无跨租户隔离 |

**open item**：生产部署前需接入认证系统（Auth0 / Clerk / 自建 JWT）。

---

## 6. 部署说明

- 部署到 Vercel 后需配置 `NEON_DATABASE_URL` 和 `V2_API_BASE_URL`
- `vercel.json` 已配置 Cron Job（每 15 分钟执行超时检查）
- 首次部署后需手动运行 `db/init.ts` 或执行 `db/init.sql` 初始化表结构
- 可选运行 `scripts/seed-data.ts` 插入演示数据
