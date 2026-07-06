'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import StatusBadge from '@/components/common/StatusBadge';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import type { ExceptionTicket } from '@/types';

export default function TicketListPage() {
  const [tickets, setTickets] = useState<ExceptionTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [loading, setLoading] = useState(true);

  const pageSize = 20;

  const fetchTickets = async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (filterStatus) params.set('status', filterStatus);
    if (filterSource) params.set('source', filterSource);
    try {
      const r = await fetch(`/api/tickets?${params}`);
      const d = await r.json();
      setTickets(d.tickets || []);
      setTotal(d.total || 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTickets(); }, [page, filterStatus, filterSource]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="main-content">
      <div className="card">
        <div className="card-header">
          <h2>📋 异常工单</h2>
          <Link href="/tickets/new" className="btn btn-primary">+ 新建工单</Link>
        </div>
        <div className="card-body">
          <div className="filter-bar">
            <div className="form-group">
              <label className="form-label">状态</label>
              <select className="form-input" value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1); }}>
                <option value="">全部状态</option>
                <option value="pending_approval">待审批</option>
                <option value="level1_approving">一级审批中</option>
                <option value="level2_approving">二级审批中</option>
                <option value="executing">执行中</option>
                <option value="completed">已完成</option>
                <option value="closed">已关闭</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">来源</label>
              <select className="form-input" value={filterSource} onChange={e => { setFilterSource(e.target.value); setPage(1); }}>
                <option value="">全部来源</option>
                <option value="manual">手工上报</option>
                <option value="scan">扫描触发</option>
              </select>
            </div>
          </div>

          {loading ? (
            <LoadingSpinner />
          ) : (
            <div className="table-wrapper" style={{ marginTop: 16 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>工单号</th>
                    <th>运单号</th>
                    <th>来源</th>
                    <th>异常类型</th>
                    <th>金额</th>
                    <th>状态</th>
                    <th>上报人</th>
                    <th>上报时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map(t => (
                    <tr key={t.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{t.ticket_no}</td>
                      <td>{t.waybill_no}</td>
                      <td>
                        <span className={`tag ${t.source === 'scan' ? 'tag-info' : 'tag-warning'}`}>
                          {t.source === 'scan' ? '扫描' : '手工'}
                        </span>
                      </td>
                      <td>{t.exception_type}</td>
                      <td>¥{Number(t.amount).toFixed(2)}</td>
                      <td><StatusBadge status={t.current_status} /></td>
                      <td>{t.reported_by}</td>
                      <td style={{ fontSize: 12 }}>{new Date(t.reported_at).toLocaleString('zh-CN')}</td>
                      <td>
                        <Link href={`/tickets/${t.id}`} className="btn btn-default" style={{ fontSize: 12 }}>
                          详情
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {tickets.length === 0 && (
                    <tr><td colSpan={9} style={{ textAlign: 'center', padding: 40, color: '#999' }}>暂无工单数据</td></tr>
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
