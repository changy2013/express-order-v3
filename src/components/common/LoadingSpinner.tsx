export default function LoadingSpinner({ text = '加载中...' }: { text?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 40, justifyContent: 'center' }}>
      <div className="spinner spinner-primary"></div>
      <span style={{ color: 'var(--color-text-secondary)' }}>{text}</span>
    </div>
  );
}
