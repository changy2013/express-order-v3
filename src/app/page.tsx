'use client';

import { useEffect, useState } from 'react';

interface Stats {
  pendingCount: number;
  todayNewCount: number;
  nearTimeoutCount: number;
  totalCompensationAmount: number;
  byStatus: Array<{ current_status: string; count: string }>;
}

const STATUS_LABEL: Record<string, string> = {
  pending_approval: '待审批',
  level1_approving: '一级审批中',
  level2_approving: '二级审批中',
  executing: '执行中',
  completed: '已完成',
  closed: '已关闭',
};

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/tickets?stats=true')
      .then(r => r.json())
      .then(d => { setStats(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const statCards = [
    {
      href: '/scan',
      icon: '📷',
      bg: '#e6f9f8',
      value: '扫描品控',
      label: 'SKU 扫描录入与品控检测',
      id: 'nav-scan',
    },
    {
      href: '/tickets',
      icon: '📋',
      bg: '#e6f7ff',
      value: '异常工单',
      label: '查看与上报异常工单',
      id: 'nav-tickets',
    },
    {
      href: '/approval',
      icon: '✅',
      bg: '#f6ffed',
      value: '审批处理',
      label: '待审批工单处理',
      id: 'nav-approval',
    },
    {
      href: '/monitoring',
      icon: '📡',
      bg: '#fffbe6',
      value: '接口监控',
      label: 'V2 接口同步状态',
      id: 'nav-monitoring',
    },
    {
      href: '/settings',
      icon: '⚙️',
      bg: '#f9f0ff',
      value: '系统配置',
      label: '审批规则与品控规则',
      id: 'nav-settings',
    },
    {
      href: '/compensation',
      icon: '💰',
      bg: '#fff7e6',
      value: '赔付记录',
      label: '赔付与追偿明细',
      id: 'nav-compensation',
    },
  ];

  return (
    <div className="app-container">
      <main className="main-content">
        <h1 style={{ marginBottom: 4 }}>运单全流程管理系统 V3</h1>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 28 }}>
          扫描品控 · 异常上报 · 分级审批 · 执行联动 — 运单全生命周期管理
        </p>

        {/* 实时统计区域 */}
        {!loading && stats && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 16,
            marginBottom: 32,
          }}>
            <div className="card" style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#0fc6c2' }}>{stats.pendingCount}</div>
              <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>⏳ 待审批工单</div>
            </div>
            <div className="card" style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#185fa5' }}>{stats.todayNewCount}</div>
              <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>📅 今日新增工单</div>
            </div>
            <div className="card" style={{
              padding: '16px 20px',
              background: stats.nearTimeoutCount > 0 ? 'rgba(250, 173, 20, 0.08)' : undefined,
              border: stats.nearTimeoutCount > 0 ? '1px solid #fa8c16' : undefined,
            }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: stats.nearTimeoutCount > 0 ? '#fa8c16' : '#595959' }}>
                {stats.nearTimeoutCount}
              </div>
              <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
                ⚠️ 即将超时工单
              </div>
            </div>
            <div className="card" style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#cf1322' }}>
                ¥{stats.totalCompensationAmount.toLocaleString('zh-CN', { minimumFractionDigits: 0 })}
              </div>
              <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>💰 赔付总额</div>
            </div>
          </div>
        )}

        {/* 工单状态分布 */}
        {!loading && stats?.byStatus && stats.byStatus.length > 0 && (
          <div className="card" style={{ marginBottom: 28, padding: '16px 20px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: '#666' }}>工单状态分布</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {stats.byStatus.map(s => (
                <a
                  key={s.current_status}
                  href={`/tickets?status=${s.current_status}`}
                  style={{
                    textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 14px', borderRadius: 20,
                    background: '#f5f5f5', color: '#333', fontSize: 13,
                    border: '1px solid #e8e8e8',
                  }}
                >
                  <span style={{ fontWeight: 700, color: '#0fc6c2' }}>{s.count}</span>
                  <span>{STATUS_LABEL[s.current_status] || s.current_status}</span>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* 功能导航 */}
        <div className="stat-grid">
          {statCards.map(card => (
            <a key={card.id} href={card.href} id={card.id} className="stat-card" style={{ textDecoration: 'none' }}>
              <div className="stat-icon" style={{ background: card.bg }}>{card.icon}</div>
              <div className="stat-info">
                <div className="stat-value">{card.value}</div>
                <div className="stat-label">{card.label}</div>
              </div>
            </a>
          ))}
        </div>
      </main>
    </div>
  );
}
