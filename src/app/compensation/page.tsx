'use client';

import { useState, useEffect } from 'react';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import Link from 'next/link';

export default function CompensationPage() {
  const [records, setRecords] = useState<any[]>([]);
  const [stats, setStats] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterDirection, setFilterDirection] = useState('');
  const [loading, setLoading] = useState(true);

  const pageSize = 20;

  const fetchData = async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (filterDirection) params.set('direction', filterDirection);
    try {
      const r = await fetch(`/api/compensation?${params}`);
      const d = await r.json();
      setRecords(d.records || []);
      setStats(d.stats || []);
      setTotal(d.total || 0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [page, filterDirection]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="main-content">
      <div className="card">
        <div className="card-header">
          <h2>💰 赔付与追偿记录</h2>
          <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 0 }}>
            <label className="form-label" style={{ marginBottom: 0 }}>类型筛选:</label>
            <select className="form-input" value={filterDirection}
              onChange={e => { setFilterDirection(e.target.value); setPage(1); }} style={{ width: 150 }}>
              <option value="">全部</option>
              <option value="to_customer">赔付客户 (货损理赔)</option>
              <option value="to_supplier">向供应商追偿 (来货异常)</option>
            </select>
          </div>
        </div>
        <div className="card-body">
          {/* 统计卡片 */}
          <div className="stat-grid" style={{ marginBottom: 20 }}>
            {stats.length > 0 ? stats.map((s: any) => (
              <div key={s.compensation_direction} className="stat-card">
                <div className="stat-icon" style={{ background: s.compensation_direction === 'to_customer' ? '#fff1f0' : '#e6f7ff' }}>
                  {s.compensation_direction === 'to_customer' ? '💸' : '📥'}
                </div>
                <div className="stat-info">
                  <div className="stat-value">¥{Number(s.total_amount).toFixed(2)}</div>
                  <div className="stat-label">
                    {s.compensation_direction === 'to_customer' ? '赔付客户 (理赔支出)' : '向供应商追偿 (追偿收入)'} ({s.count} 笔)
                  </div>
                </div>
              </div>
            )) : (
              <div className="stat-card">
                <div className="stat-info">
                  <div className="stat-value">¥0.00</div>
                  <div className="stat-label">暂无赔付记录</div>
                </div>
              </div>
            )}
          </div>

          {loading ? <LoadingSpinner /> : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>关联工单</th>
                    <th>运单号</th>
                    <th>赔付方向</th>
                    <th>金额</th>
                    <th>来源审批记录 ID (可追溯)</th>
                    <th>状态</th>
                    <th>备注</th>
                    <th>创建时间</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(r => (
                    <tr key={r.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                        {r.ticket_no ? (
                          <Link href={`/tickets/${r.ticket_id}`} style={{ color: '#0fc6c2' }}>
                            {r.ticket_no}
                          </Link>
                        ) : '-'}
                      </td>
                      <td>{r.waybill_no}</td>
                      <td>
                        <span className={`tag ${r.compensation_direction === 'to_customer' ? 'tag-error' : 'tag-success'}`} style={{ color: r.compensation_direction === 'to_customer' ? '#cf1322' : '#389e0d' }}>
                          {r.compensation_direction === 'to_customer' ? '赔付给客户' : '向供应商追偿'}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, color: r.compensation_direction === 'to_customer' ? '#cf1322' : '#389e0d' }}>
                        {r.compensation_direction === 'to_customer' ? '-' : '+'}$ {Number(r.amount).toFixed(2)}
                      </td>
                      <td>
                        {r.approval_record_id ? (
                          <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#666' }} title={r.approval_record_id}>
                            {r.approval_record_id.slice(0, 8)}...{r.approval_record_id.slice(-8)}
                          </span>
                        ) : (
                          <span style={{ color: '#999', fontSize: 12 }}>自动执行 / 未关联</span>
                        )}
                      </td>
                      <td><span className="tag-warning tag">{r.status}</span></td>
                      <td style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.remark || '-'}</td>
                      <td style={{ fontSize: 12 }}>{new Date(r.created_at).toLocaleString('zh-CN')}</td>
                    </tr>
                  ))}
                  {records.length === 0 && (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#999' }}>暂无赔付记录</td></tr>
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
