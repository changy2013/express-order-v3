'use client';

import { useState, useEffect } from 'react';
import LoadingSpinner from '@/components/common/LoadingSpinner';

export default function MonitoringPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [requestId, setRequestId] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const pageSize = 20;

  const fetchData = async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (requestId) params.set('requestId', requestId);
    try {
      const r = await fetch(`/api/sync-logs?${params}`);
      const d = await r.json();
      setLogs(d.logs || []);
      setStats(d.stats);
      setTotal(d.total || 0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [page]);

  const handleSearch = () => { setPage(1); fetchData(); };

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const r = await fetch('/api/sync-now', { method: 'POST' });
      const d = await r.json();
      alert(`同步完成: ${d.count} 条${d.error ? `, 错误: ${d.error}` : ''}`);
      fetchData();
    } catch (e: any) {
      alert(`同步失败: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="main-content">
      <div className="card">
        <div className="card-header">
          <h2>📡 V2 接口同步监控</h2>
          <button className="btn btn-primary" onClick={handleSyncNow} disabled={syncing}>
            {syncing ? <><span className="spinner"></span> 同步中...</> : '🔄 手动同步'}
          </button>
        </div>
        <div className="card-body">
          {/* 统计 */}
          {stats && (
            <div className="stat-grid" style={{ marginBottom: 20 }}>
              <div className="stat-card">
                <div className="stat-info">
                  <div className="stat-value">{stats.total || 0}</div>
                  <div className="stat-label">最近 24h 调用次数</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-info">
                  <div className="stat-value" style={{ color: 'var(--color-success)' }}>{stats.success_count || 0}</div>
                  <div className="stat-label">成功次数</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-info">
                  <div className="stat-value">{stats.avg_duration || 0}ms</div>
                  <div className="stat-label">平均耗时</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-info">
                  <div className="stat-value" style={{ color: stats.total > 0 && (stats.success_count / stats.total) < 0.9 ? 'var(--color-error)' : 'var(--color-success)' }}>
                    {stats.total > 0 ? `${((stats.success_count / stats.total) * 100).toFixed(1)}%` : '-'}
                  </div>
                  <div className="stat-label">成功率</div>
                </div>
              </div>
            </div>
          )}

          {/* 搜索 */}
          <div className="filter-bar" style={{ marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">Request ID</label>
              <input className="form-input" value={requestId} onChange={e => setRequestId(e.target.value)}
                placeholder="按 Request ID 搜索" style={{ width: 280 }} />
            </div>
            <button className="btn btn-primary" onClick={handleSearch} style={{ marginBottom: 0 }}>搜索</button>
          </div>

          {loading ? <LoadingSpinner /> : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Request ID</th>
                    <th>接口名</th>
                    <th>状态码</th>
                    <th>耗时</th>
                    <th>响应摘要</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => (
                    <tr key={log.id} style={{ background: log.success ? undefined : '#fff2f0' }}>
                      <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{log.request_id?.slice(0, 8)}...</td>
                      <td>{log.api_name}</td>
                      <td>
                        {log.success
                          ? <span className="tag tag-success">{log.response_status || 'OK'}</span>
                          : <span className="tag tag-error">FAIL</span>}
                      </td>
                      <td>{log.duration_ms}ms</td>
                      <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12 }}>
                        {log.response_summary || log.error_message || '-'}
                      </td>
                      <td style={{ fontSize: 12 }}>{new Date(log.created_at).toLocaleString('zh-CN')}</td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: '#999' }}>暂无接口调用日志</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="pagination">
            <span>共 {total} 条</span>
            <div className="pagination-controls">
              <button className="btn btn-default" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button>
              <span>第 {page} / {totalPages || 1} 页</span>
              <button className="btn btn-default" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>下一页</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
