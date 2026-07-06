import { query } from './db';

export interface SyncCallParams {
  requestId: string;
  apiName: string;
  requestParams?: string;
  responseStatus?: number;
  responseSummary?: string;
  durationMs: number;
  success: boolean;
  errorMessage?: string;
}

export async function logSyncCall(params: SyncCallParams) {
  try {
    await query(
      `INSERT INTO sync_logs(id, request_id, api_name, request_params, response_status, response_summary, duration_ms, success, error_message)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        crypto.randomUUID(),
        params.requestId,
        params.apiName,
        params.requestParams || null,
        params.responseStatus || null,
        params.responseSummary || null,
        params.durationMs,
        params.success,
        params.errorMessage || null,
      ]
    );
  } catch (e) {
    console.error('sync logger failed:', e);
  }
}
