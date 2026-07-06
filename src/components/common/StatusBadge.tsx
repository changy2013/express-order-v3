const STATUS_MAP: Record<string, { label: string; className: string }> = {
  pending_approval: { label: '待审批', className: 'tag-warning' },
  level1_approving: { label: '一级审批中', className: 'tag-info' },
  level2_approving: { label: '二级审批中', className: 'tag-info' },
  executing: { label: '执行中', className: 'tag-info' },
  completed: { label: '已完成', className: 'tag-success' },
  rejected: { label: '已拒绝', className: 'tag-error' },
  closed: { label: '已关闭', className: 'tag-error' },
};

export default function StatusBadge({ status }: { status: string }) {
  const config = STATUS_MAP[status] || { label: status, className: 'tag-info' };
  return <span className={`tag ${config.className}`}>{config.label}</span>;
}

export function getStatusLabel(status: string): string {
  return STATUS_MAP[status]?.label || status;
}
