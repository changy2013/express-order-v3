'use client';

import { useState } from 'react';

export default function ScanPage() {
  const [waybillNo, setWaybillNo] = useState('');
  const [skuCode, setSkuCode] = useState('');
  const [skuName, setSkuName] = useState('');
  const [scannedQty, setScannedQty] = useState(1);
  const [batchNo, setBatchNo] = useState('');
  const [damageLevel, setDamageLevel] = useState(0);
  const [operator, setOperator] = useState('admin');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: string } | null>(null);

  const handleScan = async () => {
    if (!waybillNo || !skuCode) {
      setMessage({ text: '请填写运单号和 SKU 编码', type: 'error' });
      return;
    }
    setLoading(true);
    setResult(null);
    setMessage(null);
    try {
      const r = await fetch('/api/scan/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          waybill_no: waybillNo,
          sku_code: skuCode,
          sku_name: skuName || undefined,
          scanned_qty: scannedQty,
          batch_no: batchNo || undefined,
          damage_level: damageLevel > 0 ? damageLevel : undefined,
          operator,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setResult(d);

      if (d.passed) {
        setMessage({ text: '✅ 品控检测通过 — 正常出库', type: 'success' });
      } else if (d.alreadyExists) {
        setMessage({ text: `⚠️ 该批次已有未关闭工单，仅追加记录`, type: 'warning' });
      } else {
        setMessage({ text: `⚠️ 品控异常 — 工单 ${d.ticketNo} 已创建`, type: 'warning' });
      }
    } catch (e: any) {
      setMessage({ text: `❌ ${e.message}`, type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const handleQuickRelease = async () => {
    if (!result?.ticketId) return;
    const reason = prompt('请输入复核原因：');
    if (!reason) return;

    try {
      const r = await fetch('/api/scan/quick-release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_id: result.ticketId, reviewer: operator, reason }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setMessage({ text: `✅ 快速放行成功: ${reason}`, type: 'success' });
    } catch (e: any) {
      setMessage({ text: `❌ ${e.message}`, type: 'error' });
    }
  };

  return (
    <div className="main-content">
      <div className="card">
        <div className="card-header">
          <h2>📷 扫描品控</h2>
        </div>
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 600 }}>
          <div className="form-group">
            <label className="form-label">运单号 *</label>
            <input className="form-input" value={waybillNo} onChange={e => setWaybillNo(e.target.value)} placeholder="输入运单号" />
          </div>
          <div className="form-group">
            <label className="form-label">SKU 编码 *（模拟扫描枪）</label>
            <input className="form-input" value={skuCode} onChange={e => setSkuCode(e.target.value)} placeholder="扫描或输入 SKU 编码" />
          </div>
          <div className="form-group">
            <label className="form-label">SKU 名称</label>
            <input className="form-input" value={skuName} onChange={e => setSkuName(e.target.value)} placeholder="商品名称（可选）" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">扫描数量</label>
              <input className="form-input" type="number" value={scannedQty} onChange={e => setScannedQty(Number(e.target.value))} min={1} />
            </div>
            <div className="form-group">
              <label className="form-label">破损等级（0-5）</label>
              <input className="form-input" type="number" value={damageLevel} onChange={e => setDamageLevel(Number(e.target.value))} min={0} max={5} />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">批次号</label>
              <input className="form-input" value={batchNo} onChange={e => setBatchNo(e.target.value)} placeholder="可选" />
            </div>
            <div className="form-group">
              <label className="form-label">操作人</label>
              <input className="form-input" value={operator} onChange={e => setOperator(e.target.value)} />
            </div>
          </div>

          <button className="btn btn-primary btn-lg" onClick={handleScan} disabled={loading} style={{ marginTop: 8 }}>
            {loading ? <><span className="spinner"></span> 处理中...</> : '📷 提交扫描'}
          </button>

          {message && (
            <div className={`tag ${message.type === 'success' ? 'tag-success' : message.type === 'warning' ? 'tag-warning' : 'tag-error'}`}
              style={{ padding: '8px 16px', whiteSpace: 'normal' }}>
              {message.text}
            </div>
          )}

          {result && !result.passed && !result.alreadyExists && (
            <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p><strong>工单号:</strong> {result.ticketNo}</p>
              <p><strong>命中规则:</strong> {result.ruleName}</p>
              <p><strong>判定详情:</strong> {result.detail}</p>
              <button className="btn btn-default" onClick={handleQuickRelease} style={{ alignSelf: 'flex-start' }}>
                🔓 误判快速放行（品控主管）
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
