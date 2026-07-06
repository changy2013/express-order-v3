'use client';

import { useState, useEffect } from 'react';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'rules' | 'config'>('rules');
  const [rules, setRules] = useState<any[]>([]);
  const [configs, setConfigs] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  // 规则表单
  const [newRule, setNewRule] = useState({
    name: '', exception_type: '', trigger_conditions: '{}', severity: 'medium',
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const [rulesR, configR] = await Promise.all([
        fetch('/api/qc-rules').then(r => r.json()),
        fetch('/api/config').then(r => r.json()),
      ]);
      setRules(rulesR.rules || []);
      setConfigs(configR.configs || {});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const addRule = async () => {
    try {
      const r = await fetch('/api/qc-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newRule,
          trigger_conditions: JSON.parse(newRule.trigger_conditions),
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      setMessage('规则添加成功');
      setNewRule({ name: '', exception_type: '', trigger_conditions: '{}', severity: 'medium' });
      fetchData();
    } catch (e: any) { setMessage(`❌ ${e.message}`); }
  };

  const deleteRule = async (id: string) => {
    try {
      const r = await fetch(`/api/qc-rules?id=${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error((await r.json()).error);
      setMessage('规则已删除');
      fetchData();
    } catch (e: any) { setMessage(`❌ ${e.message}`); }
  };

  const updateConfig = async (key: string, value: any) => {
    try {
      const r = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config_key: key, config_value: value }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      setMessage(`${key} 更新成功`);
      fetchData();
    } catch (e: any) { setMessage(`❌ ${e.message}`); }
  };

  if (loading) return <div className="main-content"><LoadingSpinner /></div>;

  return (
    <div className="main-content">
      <Card title="⚙️ 系统配置">
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <button className={`btn ${activeTab === 'rules' ? 'btn-primary' : 'btn-default'}`}
            onClick={() => setActiveTab('rules')}>品控规则</button>
          <button className={`btn ${activeTab === 'config' ? 'btn-primary' : 'btn-default'}`}
            onClick={() => setActiveTab('config')}>审批阈值</button>
        </div>

        {message && <div className="tag tag-info" style={{ marginBottom: 12, padding: '6px 12px' }}>{message}</div>}

        {activeTab === 'rules' && (
          <>
            {/* 现有规则列表 */}
            <div className="table-wrapper" style={{ marginBottom: 20 }}>
              <table className="data-table">
                <thead><tr><th>规则名称</th><th>异常类型</th><th>严重度</th><th>状态</th><th>操作</th></tr></thead>
                <tbody>
                  {rules.map(r => (
                    <tr key={r.id}>
                      <td>{r.name}</td>
                      <td>{r.exception_type}</td>
                      <td><span className="tag tag-warning">{r.severity}</span></td>
                      <td><span className={`tag ${r.enabled ? 'tag-success' : 'tag-error'}`}>{r.enabled ? '启用' : '禁用'}</span></td>
                      <td><button className="btn btn-danger" onClick={() => deleteRule(r.id)}>删除</button></td>
                    </tr>
                  ))}
                  {rules.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: '#999' }}>暂无规则</td></tr>}
                </tbody>
              </table>
            </div>

            {/* 新增规则 */}
            <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: 16 }}>
              <h4 style={{ marginBottom: 12 }}>新增品控规则</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="form-group">
                  <label className="form-label">规则名称</label>
                  <input className="form-input" value={newRule.name} onChange={e => setNewRule(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">异常类型</label>
                  <input className="form-input" value={newRule.exception_type} onChange={e => setNewRule(p => ({ ...p, exception_type: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="form-label">触发条件 (JSON)</label>
                  <input className="form-input" value={newRule.trigger_conditions} onChange={e => setNewRule(p => ({ ...p, trigger_conditions: e.target.value }))}
                    placeholder='{"qty_diff_percent": 5}' />
                </div>
                <div className="form-group">
                  <label className="form-label">严重度</label>
                  <select className="form-input" value={newRule.severity} onChange={e => setNewRule(p => ({ ...p, severity: e.target.value }))}>
                    <option value="low">低</option>
                    <option value="medium">中</option>
                    <option value="high">高</option>
                    <option value="critical">严重</option>
                  </select>
                </div>
              </div>
              <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={addRule}>添加规则</button>
            </div>
          </>
        )}

        {activeTab === 'config' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 审批金额阈值 */}
            <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: 16 }}>
              <h4>分级审批金额阈值</h4>
              {configs.approval_level_thresholds && (
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 8 }}>
                  <div className="form-group">
                    <label className="form-label">一级最大金额 (元)</label>
                    <input className="form-input" type="number" style={{ width: 150 }}
                      value={configs.approval_level_thresholds.level1_max_amount}
                      onChange={e => {
                        const v = { ...configs.approval_level_thresholds, level1_max_amount: Number(e.target.value), level2_min_amount: Number(e.target.value) + 0.01 };
                        setConfigs((p: any) => ({ ...p, approval_level_thresholds: v }));
                      }} />
                  </div>
                  <button className="btn btn-primary" style={{ marginTop: 22 }}
                    onClick={() => updateConfig('approval_level_thresholds', configs.approval_level_thresholds)}>保存</button>
                </div>
              )}
            </div>

            {/* 超时时长 */}
            <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: 16 }}>
              <h4>审批超时时长</h4>
              {configs.approval_timeout_hours && (
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                  <div className="form-group">
                    <label className="form-label">一级超时 (小时)</label>
                    <input className="form-input" type="number" style={{ width: 120 }}
                      value={configs.approval_timeout_hours.level1}
                      onChange={e => setConfigs((p: any) => ({ ...p, approval_timeout_hours: { ...p.approval_timeout_hours, level1: Number(e.target.value) } }))} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">二级超时 (小时)</label>
                    <input className="form-input" type="number" style={{ width: 120 }}
                      value={configs.approval_timeout_hours.level2}
                      onChange={e => setConfigs((p: any) => ({ ...p, approval_timeout_hours: { ...p.approval_timeout_hours, level2: Number(e.target.value) } }))} />
                  </div>
                  <button className="btn btn-primary" style={{ marginTop: 22 }}
                    onClick={() => updateConfig('approval_timeout_hours', configs.approval_timeout_hours)}>保存</button>
                </div>
              )}
            </div>

            {/* 品控暂扣超时 */}
            <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: 16 }}>
              <h4>品控暂扣超时时长</h4>
              {configs.qc_hold_timeout_minutes && (
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 8 }}>
                  <div className="form-group">
                    <label className="form-label">暂扣超时 (分钟)</label>
                    <input className="form-input" type="number" style={{ width: 120 }}
                      value={configs.qc_hold_timeout_minutes.qc_hold}
                      onChange={e => setConfigs((p: any) => ({ ...p, qc_hold_timeout_minutes: { qc_hold: Number(e.target.value) } }))} />
                  </div>
                  <button className="btn btn-primary" style={{ marginTop: 22 }}
                    onClick={() => updateConfig('qc_hold_timeout_minutes', configs.qc_hold_timeout_minutes)}>保存</button>
                </div>
              )}
              <p style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
                ⚡ 品控暂扣超时独立于审批超时。压仓成本驱动，应远短于审批超时（默认 120 分钟）
              </p>
            </div>

            {/* 重提次数 */}
            <div style={{ border: '1px solid var(--color-border-light)', borderRadius: 8, padding: 16 }}>
              <h4>拒绝重提次数上限</h4>
              {configs.reject_max_retries && (
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 8 }}>
                  <div className="form-group">
                    <label className="form-label">最大重提次数</label>
                    <input className="form-input" type="number" style={{ width: 120 }}
                      value={configs.reject_max_retries.max_retries}
                      onChange={e => setConfigs((p: any) => ({ ...p, reject_max_retries: { max_retries: Number(e.target.value) } }))} />
                  </div>
                  <button className="btn btn-primary" style={{ marginTop: 22 }}
                    onClick={() => updateConfig('reject_max_retries', configs.reject_max_retries)}>保存</button>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
