# V2 ↔ V3 接口契约与一致性设计规范

> 本文档规范运单全流程管理系统 V3 与 V2（AI 录单系统）之间的数据通信、接口协议、幂等性保障、可调试性（Traceability）及降级方案。

---

## 1. 接口汇总与拓扑

V3 与 V2 完全遵循**独立数据库、接口调用交互**的微服务化原则，严禁直接跨库读写。

```mermaid
flowchart LR
    V3[V3 异常审批系统] -- GET (Verify Sku / Details) --> V2[V2 录单系统]
    V3 -- POST (Manual Sync Snapshots) --> V2
    V2 -- POST (Optional Writeback Mark) --> V3
```

| 依赖方向 | 接口路径 | 方法 | 核心用途 | 是否必需 |
|---|---|---|---|---|
| V3 → V2 | `/api/orders?q_code={waybillNo}&pageSize=1` | GET | 校验运单存在 + 获取运单详情 | ✅ 必需 |
| V3 → V2 | `/api/orders?q_code={waybillNo}&pageSize=1` | GET | 校验 SKU 归属及订单数量（防乱扫） | ✅ 必需 |
| V3 → V2 | `/api/orders?pageSize=200` | GET | 初始化本地快照 / 增量定时同步 | ✅ 必需 |
| V3 → V2 | `/api/orders/{waybillNo}/exception-mark` | POST | 异常处理中标记回写（防止重复操作）| 🟡 可选加分 |

---

## 2. 核心接口详细规约

### 2.1 校验运单存在 + 获取详情 (GET)

#### 请求规约
```http
GET /api/orders?q_code=WB20260001&pageSize=1 HTTP/1.1
Host: v2-service.com
Authorization: Bearer v2_api_key_token_xxxxxx
```

#### 响应规约 (200 OK)
```json
{
  "groups": [
    {
      "外部编码": "WB20260001",
      "收件人姓名": "杨先生",
      "收件人电话": "13800138000",
      "收件人地址": "深圳市南山区科兴科学园 B 栋",
      "寄件人姓名": "李四",
      "寄件人电话": "13900139000",
      "寄件人地址": "北京大兴国际机场仓",
      "total_amount": "5600.00",
      "sku_items": [
        {
          "sku_code": "SKU1001",
          "sku_name": "高端机械键盘",
          "sku_quantity": 2
        }
      ],
      "created_at": "2026-07-06 12:00:00"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 1
}
```

#### 响应规约 (404 Not Found 或空匹配)
```json
{
  "groups": [],
  "total": 0,
  "page": 1,
  "pageSize": 1
}
```

---

### 2.2 校验 SKU 归属 (GET)

在仓库扫描品控录入时，前端提交 SKU 编号，V3 会同步调用此接口，解析 `sku_items` 数组。
- **验证通过**：SKU 必须存在于 `sku_items`，且其 `sku_quantity` 大于等于 1。
- **验证失败**：直接抛错 "SKU 不存在或不属于该运单，扫描被拒绝"，阻止录入异常工单。

---

## 3. 可调试性与链路追踪 (Request ID)

为了防范分布式系统下数据流对齐困难的痛点，V3 引入了 **Request ID 追踪机制**：

1. **ID 生成**：每次向 V2 发起请求时，V3 在客户端生成唯一的链路标识 UUID (如 `crypto.randomUUID()`)。
2. **日志持久化**：将 Request ID 及请求内容存入 `sync_logs`（接口同步日志表）：
   - `request_id`: 全局唯一 UUID。
   - `api_name`: 接口简写，如 `getWaybill`、`verifySku`、`syncWaybills`。
   - `request_params`: 转为 JSON 字符串的入参，如 `{"waybillNo": "WB1001"}`。
   - `response_status`: 接口返回的 HTTP 状态码（如 200, 404, 500）。
   - `response_summary`: 裁剪的前 500 字节响应报文。
   - `duration_ms`: 耗时毫秒数。
   - `success`: 布尔值，标识本次通信成功与否。
   - `error_message`: 详细的网络或业务异常堆栈。
3. **前端呈现**：V3 监控管理页 `/monitoring` 完美集成，支持通过 Request ID 一键溯源与 JSON 美化输出，方便技术支持快速定位数据缺失根源。

---

## 4. 接口异常与分类降级方案

V3 对各种边界异常做出了容错和阻断设计：

### 4.1 错误码分类规约

| 异常现象 | HTTP 状态码 | V3 侧逻辑处理 | 用户侧反馈 |
|---|---|---|---|
| **运单号不存在** | 200 (groups空) 或 404 | 拦截工单创建，直接返回验证失败。 | 提示: "运单号不存在，请核对后再试" |
| **商户无权访问** | 403 | 抛出鉴权错误，记录异常日志。 | 提示: "权限校验失败，禁止操作该订单" |
| **V2 内部发生崩溃**| 500 / 502 / 504 | 计入失败日志，并触发 2 次重试，若仍失败则提示服务错误。 | 提示: "AI 系统响应缓慢，请稍后重试" |
| **网络物理断开/超时**| Timeout (10s) | 触发指数退避重试 (1s, 2s)；若确认失败，判定服务不可用。 | 提示: "连接失败，正在降级为本地缓存模式" |

### 4.2 V2 服务整体不可用时的降级策略

1. **只读操作降级**：
   - 当用户查询工单详情或工单列表时，若 V2 接口因超时或宕机返回错误，V3 **自动降级读取本地缓存** (`waybill_snapshots` 表)。
   - 前端必须明确渲染黄色角标或横幅警示：`⚠️ 本地缓存（同步于 2026-07-06 12:00:00）` 且标注 `V2 系统临时不可用`，绝不能发生白屏或服务端崩溃。
2. **写操作强阻断**：
   - 异常上报 (Manual Report) 和 扫描品控异常 (Scan QC) 属于强一致性业务，**不可无凭无据凭空捏造运单**。
   - 若 V2 服务完全不可用，V3 侧会拒绝创建新异常工单，并友好向仓储作业人员展示 "AI 系统正在维护，请稍后再试，已锁定的批次将继续保持暂扣状态"。

---

## 5. 跨系统回写机制 (设计方案)

为了实现老系统的二开友好和数据回流，我们设计了 **V3 → V2 的回写接口**，用以在 V2 订单视图中提供状态联动。

### 5.1 异步推送事件 (Webhook)

在 V3 的执行联动主事务成功提交后，系统将在后台触发向 V2 的回调（不阻塞 V3 主流程交易），将异常标记写入 V2。

```http
POST /api/orders/{waybillNo}/exception-mark HTTP/1.1
Host: v2-service.com
Authorization: Bearer v3_token_auth_xxxxxx
Content-Type: application/json

{
  "has_exception": true,
  "ticket_no": "QC20260706XYZ",
  "exception_status": "completed",
  "exception_type": "破损",
  "compensation_direction": "to_supplier",
  "amount": 100.00
}
```

### 5.2 兼容与容错性设计

- **灰度发布**：回写模块支持在环境变量中单独关闭 (`ENABLE_V2_WRITEBACK=false`)。
- **字段向后兼容原则**：新增字段均应使用可选字段，V2 的反序列化解析应具有**容忍未知字段**的特性（防御性解析）。如果金额类型由于二开由 `int` 变为 `decimal`，V3 会使用类型推导进行转换，避免类型强校验崩溃。
