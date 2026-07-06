export default function Home() {
  return (
    <div className="app-container">
      <header className="header">
        <div className="logo-section">
          <div className="logo-icon">鲸</div>
          <span className="logo-text">运单全流程管理系统 V3</span>
        </div>
      </header>
      <main className="main-content">
        <h1>欢迎使用运单全流程管理系统</h1>
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: 24 }}>
          扫描品控 · 异常上报 · 分级审批 · 执行联动 — 运单全生命周期管理
        </p>
        <div className="stat-grid">
          <a href="/scan" className="stat-card" style={{ textDecoration: 'none' }}>
            <div className="stat-icon" style={{ background: '#e6f9f8' }}>📷</div>
            <div className="stat-info">
              <div className="stat-value">扫描品控</div>
              <div className="stat-label">SKU 扫描录入与品控检测</div>
            </div>
          </a>
          <a href="/tickets" className="stat-card" style={{ textDecoration: 'none' }}>
            <div className="stat-icon" style={{ background: '#e6f7ff' }}>📋</div>
            <div className="stat-info">
              <div className="stat-value">异常工单</div>
              <div className="stat-label">查看与上报异常工单</div>
            </div>
          </a>
          <a href="/approval" className="stat-card" style={{ textDecoration: 'none' }}>
            <div className="stat-icon" style={{ background: '#f6ffed' }}>✅</div>
            <div className="stat-info">
              <div className="stat-value">审批处理</div>
              <div className="stat-label">待审批工单处理</div>
            </div>
          </a>
          <a href="/monitoring" className="stat-card" style={{ textDecoration: 'none' }}>
            <div className="stat-icon" style={{ background: '#fffbe6' }}>📡</div>
            <div className="stat-info">
              <div className="stat-value">接口监控</div>
              <div className="stat-label">V2 接口同步状态</div>
            </div>
          </a>
        </div>
      </main>
    </div>
  );
}
