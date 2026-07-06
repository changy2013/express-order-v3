'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import StatusBadge from '@/components/common/StatusBadge';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import type { ExceptionTicket } from '@/types';

/** 审批确认 Modal */
function ConfirmModal({
  open,
  title,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  onConfirm: (comment: string) => void;
  onCancel: () => void;
}) {
  const [comment, setComment] = useState('');
  if (!open) return null;
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 28, width: 400,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      }}>
        <h3 style={{ marginBottom: 16 }}>{title}</h3>
        <div className="form-group">
          <label className="form-label">审批意见（可选）</label>
          <textarea
            className="form-input"
            rows={3}
            placeholder="请填写审批意见..."
            value={comment}
            onChange={e => setComment(e.target.value)}
            style={{ resize: 'vertical' }}
            id="approval-comment-input"
          />
        </div>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-default" onClick={onCancel} id="btn-cancel-approval">取消</button>
          <button className="btn btn-primary" onClick={() => { onConfirm(comment); setComment(''); }} id="btn-confirm-approval">
            确认提交
          </button>
        </div>
      </div>
    </div>
  );
}

const ROLE_OPTIONS = [
  { value: 'level1_approver', label: '一级审批人', visibleStatuses: ['pending_approval', 'level1_approving'] },
  { value: 'level2_approver', label: '二级审批人', visibleStatuses: ['level2_approving'] },
  { value: 'qc_supervisor', label: '品控主管', visibleStatuses: [] },
  { value: 'admin', label: '管理员（全权限）', visibleStatuses: ['pending_approval', 'level1_approving', 'level2_approving'] },
];

export default function ApprovalPage() {
  const [tickets, setTickets] = useState<ExceptionTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [approver, setApprover] = useState('level1_approver');
  const [approverName, setApproverName] = useState('审批员A');

  // Modal 状态
  const [modal, setModal] = useState<{
    open: boolean;
    title: string;
    ticketId: string;
    action: 'approve' | 'reject';
    approvalLevel: string;
  } | null>(null);

  const currentRole = ROLE_OPTIONS.find(r => r.value === approver);

  const fetchPendingTickets = useCallback(async () => {
    setLoading(true);
    try {
      // 根据角色过滤可见工单状态
      let statusFilter = 'pending_approval,level1_approving,level2_approving';
      if (approver === 'level1_approver') statusFilter = 'pending_approval,level1_approving';
      if (approver === 'level2_approver') statusFilter = 'level2_approving';

      const r = await fetch(`/api/tickets?status=${statusFilter}&pageSize=50`);
      const d = await r.json();
      setTickets(d.tickets || []);
    } finally {
      setLoading(false);
    }
  }, [approver]);

  useEffect(() => { fetchPendingTickets(); }, [fetchPendingTickets]);

  const handleAction = async (comment: string) => {
    if (!modal) return;
    const { ticketId, action, approvalLevel } = modal;
    setModal(null);

    const token = crypto.randomUUID();
    setActionLoading(ticketId);
    try {
      const r = await fetch('/api/approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_id: ticketId,
          approver: approverName,
          approver_role: approver,
          action,
          approval_level: approvalLevel,
          operation_token: token,
          comment: comment || undefined,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (r.status === 409) {
          showToast(`⚠️ 并发冲突：${d.error}`, 'warning');
        } else if (r.status === 403) {
          showToast(`⛔ 权限不足：${d.error}`, 'error');
        } else {
          showToast(`❌ ${d.error}`, 'error');
        }
      } else {
        showToast(`✅ 操作成功：工单已${action === 'approve' ? '通过' : '拒绝'}`, 'success');
        fetchPendingTickets();
      }
    } catch (e: any) {
      showToast(`❌ ${e.message}`, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const showToast = (msg: string, type: string) => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const getApprovalLevel = (t: ExceptionTicket): string => {
    if (t.current_status === 'level2_approving') return 'level2';
    return 'level1';
  };

  const canApproveTicket = (t: ExceptionTicket): boolean => {
    if (approver === 'admin') return true;
    if (approver === 'level1_approver') return ['pending_approval', 'level1_approving'].includes(t.current_status);
    if (approver === 'level2_approver') return t.current_status === 'level2_approving';
    return false;
  };

  return (
    <>
      {/* Toast 提示 */}
      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 2000,
          background: toast.type === 'success' ? '#f6ffed' : toast.type === 'warning' ? '#fffbe6' : '#fff2f0',
          border: `1px solid ${toast.type === 'success' ? '#b7eb8f' : toast.type === 'warning' ? '#ffe58f' : '#ffccc7'}`,
          borderRadius: 8, padding: '12px 20px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          maxWidth: 380, animation: 'slideIn 0.3s ease',
        }}>
          {toast.msg}
        </div>
      )}

      {/* 审批确认 Modal */}
      {modal && (
        <ConfirmModal
          open={modal.open}
          title={modal.action === 'approve' ? '✅ 确认通过该工单？' : '❌ 确认拒绝该工单？'}
          onConfirm={handleAction}
          onCancel={() => setModal(null)}
        />
      )}

      <div className="main-content">
        <div className="card">
          <div className="card-header">
            <h2>✅ 审批处理</h2>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 0 }}>
                <label className="form-label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>当前角色:</label>
                <select id="approver-role-select" className="form-input" value={approver}
                  onChange={e => setApprover(e.target.value)} style={{ width: 160 }}>
                  {ROLE_OPTIONS.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 0 }}>
                <label className="form-label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>审批人名称:</label>
                <input id="approver-name-input" className="form-input" value={approverName}
                  onChange={e => setApproverName(e.target.value)} style={{ width: 120 }} />
              </div>
              <button className="btn btn-default" onClick={() => fetchPendingTickets()} id="btn-refresh-approval">
                🔄 刷新
              </button>
            </div>
          </div>

          {/* 角色说明 */}
          {approver === 'qc_supervisor' && (
            <div style={{ margin: '12px 20px', padding: '10px 16px', background: '#e6f9f8', borderRadius: 8, fontSize: 13 }}>
              ℹ️ 品控主管仅可通过「扫描品控」页面执行快速放行操作，无法在此审批工单
            </div>
          )}

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
                        <td>
                          <Link href={`/tickets/${t.id}`} style={{ color: '#0fc6c2', fontFamily: 'monospace', fontSize: 12 }}>
                            {t.ticket_no}
                          </Link>
                        </td>
                        <td>{t.waybill_no}</td>
                        <td>
                          <span className={`tag ${t.source === 'scan' ? 'tag-info' : 'tag-warning'}`}>
                            {t.source === 'scan' ? '📷 扫描' : '✋ 手工'}
                          </span>
                        </td>
                        <td>{t.exception_type}</td>
                        <td style={{ fontWeight: 600, color: Number(t.amount) > 5000 ? '#cf1322' : undefined }}>
                          ¥{Number(t.amount).toFixed(2)}
                          {Number(t.amount) > 5000 && <span style={{ fontSize: 10, marginLeft: 4 }}>⚠️高额</span>}
                        </td>
                        <td><StatusBadge status={t.current_status} /></td>
                        <td>{t.reported_by}</td>
                        <td>
                          {actionLoading === t.id ? (
                            <span className="spinner spinner-primary"></span>
                          ) : canApproveTicket(t) ? (
                            <div style={{ display: 'flex', gap: 6 }}>
                              {t.current_status !== 'pending_approval' ? (
                                <>
                                  <button
                                    id={`btn-approve-${t.id}`}
                                    className="btn btn-primary"
                                    onClick={() => setModal({ open: true, title: '通过', ticketId: t.id, action: 'approve', approvalLevel: getApprovalLevel(t) })}
                                  >
                                    通过
                                  </button>
                                  <button
                                    id={`btn-reject-${t.id}`}
                                    className="btn btn-danger"
                                    onClick={() => setModal({ open: true, title: '拒绝', ticketId: t.id, action: 'reject', approvalLevel: getApprovalLevel(t) })}
                                  >
                                    拒绝
                                  </button>
                                </>
                              ) : (
                                <button
                                  id={`btn-submit-${t.id}`}
                                  className="btn btn-primary"
                                  onClick={() => setModal({ open: true, title: '提交审批', ticketId: t.id, action: 'approve', approvalLevel: 'level1' })}
                                >
                                  提交审批
                                </button>
                              )}
                            </div>
                          ) : (
                            <span style={{ fontSize: 12, color: '#aaa' }}>无权操作</span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {tickets.length === 0 && (
                      <tr>
                        <td colSpan={8} style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                          {approver === 'qc_supervisor' ? '品控主管无工单审批权限' : '暂无待审批工单'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
