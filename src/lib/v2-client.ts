import { logSyncCall } from './sync-logger';
import { query } from './db';
import type { V2WaybillDetail, V2SkuVerifyResult, V2WaybillListResponse } from '@/types';

const V2_BASE = process.env.V2_API_BASE_URL || 'http://localhost:3000';
const V2_API_KEY = process.env.V2_API_KEY || '';
const TIMEOUT_MS = 10000;
const MAX_RETRIES = 2;

function getAuthHeaders(): Record<string, string> {
  return {
    'Authorization': `Bearer ${V2_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function fetchWithRetry(url: string, options: RequestInit = {}, retries = MAX_RETRIES): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { ...getAuthHeaders(), ...options.headers },
    });
    clearTimeout(timeoutId);
    return response;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (retries > 0 && (err.name === 'AbortError' || err.type === 'system')) {
      const delay = (MAX_RETRIES - retries + 1) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1);
    }
    throw err;
  }
}

export class V2Client {
  /**
   * 校验运单是否存在并获取详情
   * 发起异常上报时的真实性校验（实时调用 V2 接口）
   */
  static async getWaybill(waybillNo: string): Promise<{ data?: V2WaybillDetail; error?: string }> {
    const requestId = crypto.randomUUID();
    const start = Date.now();
    try {
      const res = await fetchWithRetry(
        `${V2_BASE}/api/v2/waybills/${encodeURIComponent(waybillNo)}`
      );
      const duration = Date.now() - start;
      const body = await res.json();

      await logSyncCall({
        requestId, apiName: 'getWaybill', requestParams: JSON.stringify({ waybillNo }),
        responseStatus: res.status, responseSummary: JSON.stringify(body).slice(0, 500),
        durationMs: duration, success: res.ok, errorMessage: res.ok ? undefined : body.error,
      });

      if (!res.ok) return { error: body.error || '运单查询失败' };
      return { data: body as V2WaybillDetail };
    } catch (err: any) {
      const duration = Date.now() - start;
      await logSyncCall({
        requestId, apiName: 'getWaybill', requestParams: JSON.stringify({ waybillNo }),
        durationMs: duration, success: false, errorMessage: err.message,
      });
      return { error: `V2 接口不可用: ${err.message}` };
    }
  }

  /**
   * 校验 SKU 是否归属于指定运单（扫描录入时验证）
   */
  static async verifySku(waybillNo: string, skuCode: string): Promise<{ data?: V2SkuVerifyResult; error?: string }> {
    const requestId = crypto.randomUUID();
    const start = Date.now();
    try {
      const res = await fetchWithRetry(
        `${V2_BASE}/api/v2/waybills/${encodeURIComponent(waybillNo)}/skus/${encodeURIComponent(skuCode)}`
      );
      const duration = Date.now() - start;
      const body = await res.json();

      await logSyncCall({
        requestId, apiName: 'verifySku', requestParams: JSON.stringify({ waybillNo, skuCode }),
        responseStatus: res.status, responseSummary: JSON.stringify(body).slice(0, 500),
        durationMs: duration, success: res.ok, errorMessage: res.ok ? undefined : body.error,
      });

      if (!res.ok) return { error: body.error || 'SKU 校验失败' };
      return { data: body as V2SkuVerifyResult };
    } catch (err: any) {
      const duration = Date.now() - start;
      await logSyncCall({
        requestId, apiName: 'verifySku', requestParams: JSON.stringify({ waybillNo, skuCode }),
        durationMs: duration, success: false, errorMessage: err.message,
      });
      return { error: `V2 接口不可用: ${err.message}` };
    }
  }

  /**
   * 同步运单列表到本地快照
   */
  static async syncWaybills(): Promise<{ count: number; error?: string }> {
    const requestId = crypto.randomUUID();
    const start = Date.now();
    try {
      const res = await fetchWithRetry(`${V2_BASE}/api/v2/waybills?pageSize=200`);
      const duration = Date.now() - start;
      const body = await res.json();

      await logSyncCall({
        requestId, apiName: 'syncWaybills', requestParams: '{}',
        responseStatus: res.status, responseSummary: JSON.stringify(body).slice(0, 500),
        durationMs: duration, success: res.ok,
      });

      if (!res.ok) return { count: 0, error: body.error };

      const waybills = body.waybills || [];
      let count = 0;
      for (const wb of waybills) {
        if (!wb.waybill_no) continue;

        const skuSummary = (wb.sku_items || []).map((s: any) => ({
          sku_code: s.sku_code,
          sku_name: s.sku_name,
          quantity: s.quantity || 1,
        }));

        await query(
          `INSERT INTO waybill_snapshots(id, waybill_no, receiver_name, receiver_phone, receiver_address, total_amount, sku_summary, last_synced_at)
           VALUES($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (waybill_no) DO UPDATE SET
             receiver_name = EXCLUDED.receiver_name,
             receiver_phone = EXCLUDED.receiver_phone,
             receiver_address = EXCLUDED.receiver_address,
             total_amount = EXCLUDED.total_amount,
             sku_summary = EXCLUDED.sku_summary,
             last_synced_at = NOW()`,
          [
            crypto.randomUUID(),
            wb.waybill_no,
            wb.receiver_name || null,
            wb.receiver_phone || null,
            wb.receiver_address || null,
            Number(wb.total_amount || 0),
            JSON.stringify(skuSummary),
          ]
        );
        count++;
      }
      return { count };
    } catch (err: any) {
      const duration = Date.now() - start;
      await logSyncCall({
        requestId, apiName: 'syncWaybills', durationMs: duration, success: false, errorMessage: err.message,
      });
      return { count: 0, error: err.message };
    }
  }

  /**
   * 从本地快照获取运单详情（降级方案）
   * V2 不可用时使用本地缓存数据
   */
  static async getLocalWaybill(waybillNo: string): Promise<{ data?: any; syncedAt?: string }> {
    try {
      const res = await query(
        `SELECT * FROM waybill_snapshots WHERE waybill_no = $1`,
        [waybillNo]
      );
      if (res.rows.length === 0) return {};
      return { data: res.rows[0], syncedAt: res.rows[0].last_synced_at };
    } catch {
      return {};
    }
  }
}
