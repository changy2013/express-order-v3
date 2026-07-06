# V2 ↔ V3 接口文档

> V3 系统通过 HTTP API 调用 V2 获取运单数据。本文档定义 V3 对 V2 的接口依赖。

---

## 1. 接口汇总

| 接口 | 方法 | 用途 | 必需 |
|------|------|------|------|
| `/api/orders?q_code=xxx` | GET | 按运单号查询运单详情 | ✅ |
| `/api/orders/check-dup` | POST | 批量查重（可选） | ❌ |

---

## 2. 查询运单详情

### 请求

```
GET /api/orders?q_code={运单号}
```

### 成功响应示例

```json
{
  "groups": [
    {
      "外部编码": "WB20240001",
      "收件人姓名": "张三",
      "收件人电话": "13800138000",
      "收件人地址": "北京市朝阳区...",
      "寄件人姓名": "李四",
      "寄件人电话": "13900139000",
      "寄件人地址": "上海市浦东新区...",
      "物品名称": "电子产品",
      "物品数量": "2",
      "物品重量": "1.5",
      "下单时间": "2024-01-01 10:00:00"
    }
  ]
}
```

### 异常响应

```json
{ "error": "运单不存在" }
```

### V3 消费端

| 文件 | 类/函数 |
|------|--------|
| `src/lib/v2-client.ts` | `getWaybillFromV2(q_code)` |
| `src/lib/v2-client.ts` | `getLocalWaybill(q_code)` (V2 不可用时降级) |

### 重试策略

- 最多 2 次重试，指数退避（1s, 2s）
- 单次超时 10s
- 所有调用记录写入 `sync_logs` 表

---

## 3. 批量查重（可选）

### 请求

```
POST /api/orders/check-dup
Content-Type: application/json

{ "q_codes": ["WB20240001", "WB20240002", "..."], "max_count": 200 }
```

### 成功响应

```json
{
  "duplicates": [
    { "q_code": "WB20240001", "exists": true },
    { "q_code": "WB20240002", "exists": false }
  ]
}
```

### 用途

- V3 系统扫描导入时，可先调此接口预检运单是否已在 V2 存在
- 避免创建重复的异常工单

---

## 4. V3 提供给 V2 的接口（待确认）

目前 V3 未提供被 V2 调用的接口。**open item**: 是否需要 V3 回写状态给 V2？如工单处理完成后通知 V2 更新运单状态。

---

## 5. 环境配置

```env
# .env.local
V2_API_BASE_URL=https://express-order.vercel.app
```

V3 所有 V2 调用通过 `V2_API_BASE_URL` 拼接，便于不同环境切换。
