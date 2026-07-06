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
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

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
      alert(`同步完成: 已同步 ${d.count} 条运单快照记录${d.error ? `, 错误: ${d.error}` : ''}`);
      fetchData();
    } catch (e: any) {
      alert(`同步失败: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedLogId(expandedLogId === id ? null : id);
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="main-content">
      <div className="card">
        <div className="card-header">
          <h2>📡 V2 接口同步监控</h2>
          <button className="btn btn-primary" onClick={handleSyncNow} disabled={syncing}>
            {syncing ? <><span className="spinner"></span> 同步中...</> : '🔄 立即同步 V2 运单数据'}
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
                  <div className="stat-value" style={{ color: '#389e0d' }}>{stats.success_count || 0}</div>
                  <div className="stat-label">成功次数</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-info">
                  <div className="stat-value">{stats.avg_duration || 0}ms</div>
                  <div className="stat-label">平均响应时间</div>
                </div>
              </div>
              <div className="stat-card">
                <div className="stat-info">
                  <div className="stat-value" style={{ color: stats.total > 0 && (stats.success_count / stats.total) < 0.9 ? '#cf1322' : '#389e0d' }}>
                    {stats.total > 0 ? `${((stats.success_count / stats.total) * 100).toFixed(1)}%` : '-'}
                  </div>
                  <div className="stat-label">成功率 (SLO 90%)</div>
                </div>
              </div>
            </div>
          )}

          {/* 搜索 */}
          <div className="filter-bar" style={{ marginBottom: 16 }}>
            <div className="form-group">
              <label className="form-label">按 Request ID 或运单号搜索</label>
              <div style={{ display: 'flex', gap: 12 }}>
                <input className="form-input" value={requestId} onChange={e => setRequestId(e.target.value)}
                  placeholder="输入完整 Request ID" style={{ width: 320 }} />
                <button className="btn btn-primary" onClick={handleSearch} style={{ marginBottom: 0 }}>查询</button>
              </div>
            </div>
          </div>

          {loading ? <LoadingSpinner /> : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>Request ID</th>
                    <th>接口方法/服务</th>
                    <th>状态</th>
                    <th>耗时</th>
                    <th>响应摘要</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(log => {
                    const isExpanded = expandedLogId === log.id;
                    return (
                      <>
                        <tr key={log.id} style={{ background: log.success ? undefined : '#fff2f0', cursor: 'pointer' }} onClick={() => toggleExpand(log.id)}>
                          <td style={{ textAlign: 'center', width: 40 }}>
                            {isExpanded ? '▼' : '▶'}
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: 11 }}>
                            {log.request_id}
                          </td>
                          <td>
                            <strong>{log.api_name}</strong>
                          </td>
                          <td>
                            {log.success
                              ? <span className="tag tag-success">HTTP {log.response_status || 200}</span>
                              : <span className="tag tag-error" style={{ background: '#ffccc7', color: '#cf1322' }}>HTTP {log.response_status || 'ERR'}</span>}
                          </td>
                          <td>{log.duration_ms} ms</td>
                          <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 12 }}>
                            {log.error_message || log.response_summary || '-'}
                          </td>
                          <td style={{ fontSize: 12 }}>{new Date(log.created_at).toLocaleString('zh-CN')}</td>
                        </tr>
                        {isExpanded && (
                          <tr style={{ background: log.success ? '#fafafa' : '#fffaf9' }}>
                            <td colSpan={7} style={{ padding: '16px 24px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <div>
                                  <strong>Request ID:</strong> <code style={{ background: '#eee', padding: '2px 6px', borderRadius: 4 }}>{log.request_id}</code>
                                </div>
                                <div>
                                  <strong>请求参数:</strong>
                                  <pre style={{ background: '#f0f0f0', padding: 12, borderRadius: 8, marginTop: 4, overflowX: 'auto', fontSize: 12 }}>
                                    {log.request_params ? JSON.stringify(JSON.parse(log.request_params), null, 2) : '无'}
                                  </pre>
                                </div>
                                <div>
                                  <strong>接口应答数据:</strong>
                                  <pre style={{ background: '#f0f0f0', padding: 12, borderRadius: 8, marginTop: 4, overflowX: 'auto', fontSize: 12 }}>
                                    {log.response_summary ? (
                                      (() => {
                                        try {
                                          return JSON.stringify(JSON.parse(log.response_summary), null, 2);
                                        } catch {
                                          return log.response_summary;
                                        }
                                      })()
                                    ) : '无摘要'}
                                  </pre>
                                </div>
                                {log.error_message && (
                                  <div>
                                    <strong style={{ color: '#cf1322' }}>异常错误信息:</strong>
                                    <pre style={{ background: '#fff2f0', border: '1px solid #ffccc7', color: '#cf1322', padding: 12, borderRadius: 8, marginTop: 4, overflowX: 'auto', fontSize: 12 }}>
                                      {log.error_message}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                  {logs.length === 0 && (
                    <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#999' }}>暂无接口调用日志</td></tr>
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
