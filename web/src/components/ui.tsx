'use client';

const TONE: Record<string, string> = {
  completed: 'ok',
  succeeded: 'ok',
  sent: 'ok',
  running: 'run',
  pending: '',
  skipped: '',
  paused: 'warn',
  awaiting_approval: 'warn',
  failed: 'err',
  rejected: 'err',
  cancelled: 'err',
};

const LABEL: Record<string, string> = {
  awaiting_approval: 'awaiting approval',
};

export function StatusBadge({ status, live }: { status?: string | null; live?: boolean }) {
  if (!status) return <span className="badge">no runs</span>;
  const tone = TONE[status] ?? '';
  const animate = live && (status === 'running' || status === 'awaiting_approval');
  return (
    <span className={`badge ${tone}`}>
      <span className={`dot ${animate ? 'live' : ''}`} />
      {LABEL[status] ?? status}
    </span>
  );
}

export function RoleBadge({ role }: { role: string }) {
  return <span className={`badge ${role === 'owner' ? 'run' : ''}`}>{role}</span>;
}

export function Meter({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className={`meter ${pct >= 85 ? 'hot' : ''}`}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ErrorText({ error }: { error?: unknown }) {
  if (!error) return null;
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
  return <div className="alert err">{message}</div>;
}

export function Json({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;
  return <pre className="mono">{JSON.stringify(value, null, 2)}</pre>;
}

export function relTime(value?: string | null) {
  if (!value) return '—';
  const then = new Date(value).getTime();
  const diff = Math.round((Date.now() - then) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return new Date(value).toLocaleDateString();
}

export function duration(from?: string | null, to?: string | null) {
  if (!from) return '—';
  const end = to ? new Date(to).getTime() : Date.now();
  const seconds = Math.max(0, (end - new Date(from).getTime()) / 1000);
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
