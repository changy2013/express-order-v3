'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import StatusBadge from '@/components/common/StatusBadge';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import type { ExceptionTicket } from '@/types';

export default function ApprovalPage() {
  const [tickets, setTickets] = useState<ExceptionTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [approver, setApprover] = useState('level1_approver');

  const fetchPendingTickets = async (status = 'pending_approval,level1_approving,level2_approving') => {
    setLoading(true);
    try {
      const r = await fetch(`/api/tickets?status=${status}&pageSize=50`);
      const d = await r.json();
      setTickets(d.tickets || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPendingTickets(); }, []);

  const handleAction = async (ticketId: string, action: 'approve' | 'reject', approvalLevel: string) => {
    const token = crypto.randomUUID();
    const comment = prompt(`请输入${action === 'approve' ? '通过' : '拒绝'}意见（可选）：`);
    // comment 可以为空

    setActionLoading(ticketId);
    try {
      const r = await fetch('/api/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_id: ticketId,
          approver,
          action,
          approval_level: approvalLevel,
          operation_token: token,
          comment: comment || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (r.status === 409) {
          alert(`⚠️ ${d.error}`);
        } else if (r.status === 403) {
          alert(`⛔ ${d.error}`);
        } else {
          alert(`❌ ${d.error}`);
        }
      } else {
        fetchPendingTickets();
      }
    } catch (e: any) {
      alert(`❌ ${e.message}`);
    } finally {
      setActionLoading(null);
    }
  };

  // 获取该工单应该用什么审批层级
  const getApprovalLevel = (t: ExceptionTicket): string => {
    if (t.current_status === 'level2_approving') return 'level2';
    return 'level1';
  };

  return (
    <div className="main-content">
      <div className="card">
        <div className="card-header">
          <h2>✅ 审批处理</h2>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 0 }}>
              <label className="form-label" style={{ marginBottom: 0 }}>当前角色:</label>
              <select className="form-input" value={approver} onChange={e => setApprover(e.target.value)}
                style={{ width: 160 }}>
                <option value="level1_approver">一级审批人</option>
                <option value="level2_approver">二级审批人</option>
                <option value="qc_supervisor">品控主管</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <button className="btn btn-default" onClick={() => fetchPendingTickets()}>🔄 刷新</button>
          </div>
        </div>
        <div className="card-body">
          {loading ? (
            <LoadingSpinner />
          ) : (
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>工单号</th>
                    <th>运单号</th>
                    <th>来源</th>
                    <th>异常类型</th>
                    <th>金额</th>
                    <th>当前状态</th>
                    <th>上报人</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tickets.map(t => (
                    <tr key={t.id}>
                      <td><Link href={`/tickets/${t.id}`} style={{ color: '#0fc6c2', fontFamily: 'monospace', fontSize: 12 }}>{t.ticket_no}</Link></td>
                      <td>{t.waybill_no}</td>
                      <td><span className={`tag ${t.source === 'scan' ? 'tag-info' : 'tag-warning'}`}>{t.source === 'scan' ? '扫描' : '手工'}</span></td>
                      <td>{t.exception_type}</td>
                      <td style={{ fontWeight: 600 }}>¥{Number(t.amount).toFixed(2)}</td>
                      <td><StatusBadge status={t.current_status} /></td>
                      <td>{t.reported_by}</td>
                      <td style={{ display: 'flex', gap: 6 }}>
                        {actionLoading === t.id ? (
                          <span className="spinner spinner-primary"></span>
                        ) : (
                          <>
                            {t.current_status !== 'pending_approval' && (
                              <button className="btn btn-primary" onClick={() => handleAction(t.id, 'approve', getApprovalLevel(t))}>
                                通过
                              </button>
                            )}
                            {t.current_status !== 'pending_approval' ? (
                              <button className="btn btn-danger" onClick={() => handleAction(t.id, 'reject', getApprovalLevel(t))}>
                                拒绝
                              </button>
                            ) : (
                              <button className="btn btn-primary" onClick={() => handleAction(t.id, 'approve', 'level1')}>
                                提交审批
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                  {tickets.length === 0 && (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#999' }}>暂无待审批工单</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
