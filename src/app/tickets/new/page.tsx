'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const EXCEPTION_TYPES = ['丢件', '破损', '客户拒收', '超时未签收', '收货地址错误'];

export default function NewTicketPage() {
  const router = useRouter();
  const [waybillNo, setWaybillNo] = useState('');
  const [exceptionType, setExceptionType] = useState('');
  const [description, setDescription] = useState('');
  const [reportedBy, setReportedBy] = useState('admin');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: string } | null>(null);

  const handleSubmit = async () => {
    if (!waybillNo || !exceptionType) {
      setMessage({ text: '请填写运单号和异常类型', type: 'error' });
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const r = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          waybill_no: waybillNo,
          exception_type: exceptionType,
          description,
          reported_by: reportedBy,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setMessage({ text: `✅ 工单创建成功: ${d.ticketNo}`, type: 'success' });
      setTimeout(() => router.push('/tickets'), 1500);
    } catch (e: any) {
      setMessage({ text: `❌ ${e.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="main-content">
      <div className="card">
        <div className="card-header">
          <h2>📝 新建异常工单</h2>
          <div className="tag tag-info">
            ⚡ 将实时调用 V2 接口校验运单存在性
          </div>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 600 }}>
          <div className="form-group">
            <label className="form-label">运单号 *</label>
            <input
              className="form-input"
              value={waybillNo}
              onChange={e => setWaybillNo(e.target.value)}
              placeholder="输入运单号（将实时校验运单真实性）"
            />
          </div>
          <div className="form-group">
            <label className="form-label">异常类型 *</label>
            <select className="form-input" value={exceptionType} onChange={e => setExceptionType(e.target.value)}>
              <option value="">请选择异常类型</option>
              {EXCEPTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">描述</label>
            <textarea
              className="form-input"
              style={{ height: 100, padding: 8, resize: 'vertical' }}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="异常情况详细描述"
            />
          </div>
          <div className="form-group">
            <label className="form-label">上报人</label>
            <input className="form-input" value={reportedBy} onChange={e => setReportedBy(e.target.value)} />
          </div>

          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <button className="btn btn-primary btn-lg" onClick={handleSubmit} disabled={loading}>
              {loading ? '提交中...' : '提交工单'}
            </button>
            <button className="btn btn-default btn-lg" onClick={() => router.back()}>取消</button>
          </div>

          {message && (
            <div className={`tag ${message.type === 'success' ? 'tag-success' : 'tag-error'}`}
              style={{ padding: '8px 16px', whiteSpace: 'normal' }}>
              {message.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
