'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import StatusBadge from '@/components/common/StatusBadge';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import type { ExceptionTicket } from '@/types';

interface TicketWithTimeout extends ExceptionTicket {
  timeout_at?: string;
  is_near_timeout?: boolean;
}

export default function TicketListPage() {
  const [tickets, setTickets] = useState<TicketWithTimeout[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterApprover, setFilterApprover] = useState('');
  const [loading, setLoading] = useState(true);

  const pageSize = 20;

  const fetchTickets = async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (filterStatus) params.set('status', filterStatus);
    if (filterSource) params.set('source', filterSource);
    if (filterType) params.set('type', filterType);
    if (filterApprover) params.set('approver', filterApprover);
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

  useEffect(() => { fetchTickets(); }, [page, filterStatus, filterSource, filterType, filterApprover]);

  const totalPages = Math.ceil(total / pageSize);

  const formatTimeout = (timeoutAt?: string) => {
    if (!timeoutAt) return null;
    const diff = new Date(timeoutAt).getTime() - Date.now();
    if (diff <= 0) return '已超时';
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    return `${hours}h${mins}m 后超时`;
  };

  const sourceTag = (source: string) => (
    <span
      className={`tag ${source === 'scan' ? 'tag-info' : 'tag-warning'}`}
      style={{ fontWeight: 600, letterSpacing: 0.3 }}
    >
      {source === 'scan' ? '📷 扫描' : '✋ 手工'}
    </span>
  );

  return (
    <div className="main-content">
      <div className="card">
        <div className="card-header">
          <h2>📋 异常工单</h2>
          <Link href="/tickets/new" className="btn btn-primary" id="btn-new-ticket">+ 新建工单</Link>
        </div>
        <div className="card-body">
          {/* 筛选栏 */}
          <div className="filter-bar" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">状态</label>
              <select id="filter-status" className="form-input" value={filterStatus}
                onChange={e => { setFilterStatus(e.target.value); setPage(1); }}>
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
              <select id="filter-source" className="form-input" value={filterSource}
                onChange={e => { setFilterSource(e.target.value); setPage(1); }}>
                <option value="">全部来源</option>
                <option value="manual">手工上报</option>
                <option value="scan">扫描触发</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">异常类型</label>
              <select id="filter-type" className="form-input" value={filterType}
                onChange={e => { setFilterType(e.target.value); setPage(1); }}>
                <option value="">全部类型</option>
                <optgroup label="物流类">
                  <option value="丢件">丢件</option>
                  <option value="破损">破损</option>
                  <option value="客户拒收">客户拒收</option>
                  <option value="超时未签收">超时未签收</option>
                  <option value="收货地址错误">收货地址错误</option>
                </optgroup>
                <optgroup label="品控类">
                  <option value="数量不符">数量不符</option>
                  <option value="外观破损">外观破损</option>
                  <option value="规格不符">规格不符</option>
                  <option value="标签错误">标签错误</option>
                  <option value="批次异常">批次异常</option>
                </optgroup>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">审批人</label>
              <input id="filter-approver" className="form-input" placeholder="输入审批人名称"
                value={filterApprover} onChange={e => { setFilterApprover(e.target.value); setPage(1); }}
                style={{ width: 140 }} />
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
                    <th>超时提示</th>
                    <th>上报时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map(t => (
                    <tr
                      key={t.id}
                      style={{
                        background: t.is_near_timeout
                          ? 'rgba(250, 173, 20, 0.08)'
                          : undefined,
                        borderLeft: t.is_near_timeout ? '3px solid #fa8c16' : undefined,
                      }}
                    >
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{t.ticket_no}</td>
                      <td>{t.waybill_no}</td>
                      <td>{sourceTag(t.source)}</td>
                      <td>{t.exception_type}</td>
                      <td style={{ fontWeight: 600, color: Number(t.amount) > 5000 ? '#cf1322' : undefined }}>
                        ¥{Number(t.amount).toFixed(2)}
                      </td>
                      <td><StatusBadge status={t.current_status} /></td>
                      <td>{t.reported_by}</td>
                      <td>
                        {t.is_near_timeout ? (
                          <span style={{
                            color: '#fa8c16', fontWeight: 600, fontSize: 12,
                            display: 'flex', alignItems: 'center', gap: 4,
                          }}>
                            ⚠️ {formatTimeout(t.timeout_at)}
                          </span>
                        ) : t.timeout_at ? (
                          <span style={{ fontSize: 12, color: '#999' }}>
                            {formatTimeout(t.timeout_at)}
                          </span>
                        ) : (
                          <span style={{ fontSize: 12, color: '#bbb' }}>—</span>
                        )}
                      </td>
                      <td style={{ fontSize: 12 }}>{new Date(t.reported_at).toLocaleString('zh-CN')}</td>
                      <td>
                        <Link href={`/tickets/${t.id}`} className="btn btn-default" style={{ fontSize: 12 }}>
                          详情
                        </Link>
                      </td>
                    </tr>
                  ))}
                  {tickets.length === 0 && (
                    <tr><td colSpan={10} style={{ textAlign: 'center', padding: 40, color: '#999' }}>暂无工单数据</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="pagination">
            <span>共 {total} 条{filterStatus || filterSource ? '（已筛选）' : ''}</span>
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
