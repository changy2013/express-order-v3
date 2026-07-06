'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { path: '/', label: '首页概览', icon: '📊' },
  { path: '/scan', label: '扫描品控', icon: '📷' },
  { path: '/tickets', label: '异常工单', icon: '📋' },
  { path: '/approval', label: '审批处理', icon: '✅' },
  { path: '/compensation', label: '赔付记录', icon: '💰' },
  { path: '/monitoring', label: '接口监控', icon: '📡' },
  { path: '/settings', label: '系统配置', icon: '⚙️' },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="logo-icon" style={{ width: 28, height: 28, fontSize: 14 }}>鲸</div>
        <span className="sidebar-logo-text">运单全流程管理</span>
      </div>
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <Link
            key={item.path}
            href={item.path}
            className={`sidebar-item ${pathname === item.path ? 'active' : ''}`}
          >
            <span className="sidebar-item-icon">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
