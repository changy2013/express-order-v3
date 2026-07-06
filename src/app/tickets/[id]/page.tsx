'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import StatusBadge from '@/components/common/StatusBadge';
import LoadingSpinner from '@/components/common/LoadingSpinner';

function getApprovalLevelLabel(level: string) {
  if (level === 'level1') return '一级';
  if (level === 'level2') return '二级';
  if (level === 'qc_supervisor') return '品控主管';
  return level;
}

function getApprovalActionDisplay(action: string) {
  if (action === 'approved') return { label: '通过', className: 'tag-success' };
  if (action === 'rejected') return { label: '拒绝', className: 'tag-error' };
  if (action === 'transferred') return { label: '转交', className: 'tag-info' };
  if (action === 'quick_released') return { label: '快速放行', className: 'tag-warning' };
  return { label: action, className: 'tag-info' };
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/tickets?id=${id}`)
      .then(r => r.json())
      .then(d => { setDetail(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="main-content"><LoadingSpinner /></div>;
  if (!detail) return <div className="main-content"><div className="card"><div className="card-body">工单不存在</div></div></div>;

  const t = detail.ticket;

  return (
    <div className="main-content">
      <div className="card">
        <div className="card-header">
          <h2>📋 工单详情: {t.ticket_no}</h2>
          <StatusBadge status={t.current_status} />
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* 基本信息 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div><strong>工单号</strong><br />{t.ticket_no}</div>
            <div><strong>运单号</strong><br />{t.waybill_no}</div>
            <div><strong>来源</strong><br />{t.source === 'scan' ? '📷 扫描触发' : '✋ 手工上报'}</div>
            <div><strong>异常类型</strong><br />{t.exception_type}{t.exception_subtype ? ` / ${t.exception_subtype}` : ''}</div>
            <div><strong>金额</strong><br />¥{Number(t.amount).toFixed(2)}</div>
            <div><strong>严重度</strong><br /><span className="tag tag-warning">{t.severity}</span></div>
            <div><strong>上报人</strong><br />{t.reported_by}</div>
            <div><strong>上报时间</strong><br />{new Date(t.reported_at).toLocaleString('zh-CN')}</div>
            <div><strong>重提次数</strong><br />{t.reject_count}/{t.max_reject_limit}</div>
          </div>
          {t.description && (
            <div style={{ background: '#f7fbfb', padding: 12, borderRadius: 8 }}>
              <strong>描述：</strong>{t.description}
            </div>
          )}

          {/* 运单信息 */}
          <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: 16 }}>
            <h3 style={{ marginBottom: 12 }}>📦 运单信息</h3>
            {detail.waybill ? (
              <>
                <div className={`tag ${detail.waybill.v2Available ? 'tag-success' : 'tag-warning'}`}>
                  {detail.waybill.source === 'v2_real_time'
                    ? '✅ 实时获取自 V2'
                    : `⚠️ 本地缓存（同步于 ${detail.waybill.syncedAt ? new Date(detail.waybill.syncedAt).toLocaleString('zh-CN') : '未知'}）`}
                </div>
                {!detail.waybill.v2Available && (
                  <div className="tag tag-warning" style={{ marginTop: 4 }}>
                    ⚠️ V2 接口不可用，展示本地缓存数据
                  </div>
                )}
                {detail.waybill.data ? (
                  <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                    <div><strong>收件人：</strong>{detail.waybill.data.receiver_name || '-'}</div>
                    <div><strong>电话：</strong>{detail.waybill.data.receiver_phone || '-'}</div>
                    <div><strong>地址：</strong>{detail.waybill.data.receiver_address || '-'}</div>
                    <div><strong>金额：</strong>¥{Number(detail.waybill.data.total_amount || 0).toFixed(2)}</div>
                  </div>
                ) : (
                  <div style={{ color: '#999', marginTop: 8 }}>暂无运单数据</div>
                )}
              </>
            ) : (
              <div style={{ color: '#999' }}>暂无运单数据</div>
            )}
          </div>

          {/* 审批历史 */}
          {detail.approvals?.length > 0 && (
            <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: 16 }}>
              <h3 style={{ marginBottom: 12 }}>📝 审批历史</h3>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>审批人</th>
                      <th>层级</th>
                      <th>操作</th>
                      <th>意见</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.approvals.map((a: any) => {
                      const actionDisplay = getApprovalActionDisplay(a.action);
                      return (
                        <tr key={a.id}>
                          <td>{a.approver}</td>
                          <td>{getApprovalLevelLabel(a.approval_level)}</td>
                          <td>
                            <span className={`tag ${actionDisplay.className}`}>
                              {actionDisplay.label}
                            </span>
                          </td>
                          <td>{a.comment || '-'}</td>
                          <td style={{ fontSize: 12 }}>{new Date(a.created_at).toLocaleString('zh-CN')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 赔付记录 */}
          {detail.compensations?.length > 0 && (
            <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: 16 }}>
              <h3 style={{ marginBottom: 12 }}>💰 赔付记录</h3>
              {detail.compensations.map((c: any) => (
                <div key={c.id} style={{ display: 'flex', gap: 16, padding: '8px 0', borderBottom: '1px solid #eee', alignItems: 'center' }}>
                  <span className={`tag ${c.compensation_direction === 'to_customer' ? 'tag-success' : 'tag-info'}`}>
                    {c.compensation_direction === 'to_customer' ? '赔付客户' : '向供应商追偿'}
                  </span>
                  <span><strong>金额:</strong> ¥{Number(c.amount).toFixed(2)}</span>
                  <span><strong>状态:</strong> {c.status}</span>
                  {c.settlement_method && <span><strong>结算方式:</strong> {c.settlement_method}</span>}
                </div>
              ))}
            </div>
          )}

          {/* 库存流水 */}
          {detail.inventoryLogs?.length > 0 && (
            <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: 16 }}>
              <h3 style={{ marginBottom: 12 }}>📦 库存流水</h3>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>变更类型</th>
                      <th>变更数量</th>
                      <th>变更前</th>
                      <th>变更后</th>
                      <th>原因</th>
                      <th>时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.inventoryLogs.map((log: any) => (
                      <tr key={log.id}>
                        <td>{log.sku_code}</td>
                        <td><span className="tag tag-info">{log.change_type}</span></td>
                        <td>{log.qty_change}</td>
                        <td>{log.qty_before}</td>
                        <td>{log.qty_after}</td>
                        <td>{log.reason || '-'}</td>
                        <td style={{ fontSize: 12 }}>{new Date(log.created_at).toLocaleString('zh-CN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 扫描记录（品控） */}
          {detail.scans?.length > 0 && (
            <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: 16 }}>
              <h3 style={{ marginBottom: 12 }}>📷 扫描记录</h3>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr><th>SKU 编码</th><th>操作人</th><th>结果</th><th>判定详情</th><th>时间</th></tr>
                  </thead>
                  <tbody>
                    {detail.scans.map((s: any) => (
                      <tr key={s.id}>
                        <td>{s.sku_code}</td>
                        <td>{s.operator}</td>
                        <td><span className={`tag ${s.qc_result === 'pass' ? 'tag-success' : 'tag-error'}`}>{s.qc_result === 'pass' ? '通过' : '异常'}</span></td>
                        <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.qc_rule_detail}</td>
                        <td style={{ fontSize: 12 }}>{new Date(s.scanned_at).toLocaleString('zh-CN')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
