'use client';

import { useEffect, useState, type ReactNode } from 'react';
import {
  Alert as AlertIcon,
  Check,
  Clock,
  Copy,
  Info,
  Loader,
  Pause,
  STEP_ICON,
  TRIGGER_ICON,
  X,
} from './icons';

/* ------------------------------------------------------------------ status */

type Tone = '' | 'ok' | 'warn' | 'err' | 'accent';

const STATUS: Record<string, { tone: Tone; label: string; live?: boolean }> = {
  completed: { tone: 'ok', label: 'completed' },
  succeeded: { tone: 'ok', label: 'succeeded' },
  sent: { tone: 'ok', label: 'sent' },
  running: { tone: 'accent', label: 'running', live: true },
  pending: { tone: '', label: 'queued' },
  skipped: { tone: '', label: 'skipped' },
  paused: { tone: 'warn', label: 'paused', live: true },
  awaiting_approval: { tone: 'warn', label: 'awaiting approval', live: true },
  failed: { tone: 'err', label: 'failed' },
  rejected: { tone: 'err', label: 'rejected' },
  cancelled: { tone: 'err', label: 'cancelled' },
};

export function StatusBadge({ status, plain }: { status?: string | null; plain?: boolean }) {
  if (!status) return <span className="badge">never run</span>;
  const meta = STATUS[status] ?? { tone: '' as Tone, label: status };
  return (
    <span className={`badge ${meta.tone} ${plain ? 'plain' : ''}`}>
      <span className={`dot ${meta.live ? 'pulse' : ''}`} />
      {meta.label}
    </span>
  );
}

export function StatusGlyph({ status, size = 14 }: { status: string; size?: number }) {
  if (status === 'succeeded' || status === 'completed') return <Check size={size} />;
  if (status === 'failed' || status === 'rejected' || status === 'cancelled') return <X size={size} />;
  if (status === 'awaiting_approval' || status === 'paused') return <Pause size={size} />;
  if (status === 'running') return <Loader size={size} className="spin" />;
  return <Clock size={size} />;
}

export const statusTone = (status?: string | null): Tone => STATUS[status ?? '']?.tone ?? '';

/* -------------------------------------------------------------- step types */

export const STEP_META: Record<
  string,
  { label: string; color: string; blurb: string; ownerOnly?: boolean }
> = {
  llm_call: { label: 'LLM call', color: 'var(--type-llm)', blurb: 'Ask a model' },
  http_request: { label: 'HTTP request', color: 'var(--type-http)', blurb: 'Call any API' },
  conditional_branch: { label: 'Condition', color: 'var(--type-branch)', blurb: 'Branch on output' },
  approval_gate: { label: 'Approval gate', color: 'var(--type-approval)', blurb: 'Pause for a human' },
  db_write: { label: 'DB write', color: 'var(--type-db)', blurb: 'Persist a result', ownerOnly: true },
  notify: { label: 'Notify', color: 'var(--type-notify)', blurb: 'Slack via event trigger', ownerOnly: true },
};

export const TRIGGER_META: Record<string, { label: string; blurb: string; ownerOnly?: boolean }> = {
  manual: { label: 'Manual', blurb: 'Someone presses Run' },
  webhook: { label: 'Webhook', blurb: 'External system posts in', ownerOnly: true },
  scheduled: { label: 'Scheduled', blurb: 'Cron, checked every minute' },
  database_event: { label: 'DB event', blurb: 'A row change starts it' },
};

export function TypePill({ type, size = 12 }: { type: string; size?: number }) {
  const meta = STEP_META[type];
  const Icon = STEP_ICON[type];
  if (!meta) return <span className="badge">{type}</span>;
  return (
    <span
      className="type-pill"
      style={{
        color: meta.color,
        borderColor: `color-mix(in srgb, ${meta.color} 32%, transparent)`,
        background: `color-mix(in srgb, ${meta.color} 11%, transparent)`,
      }}
    >
      {Icon && <Icon size={size} />}
      {meta.label}
    </span>
  );
}

export function TriggerPill({ type, muted }: { type: string; muted?: boolean }) {
  const Icon = TRIGGER_ICON[type];
  return (
    <span className={`badge ${muted ? '' : 'accent'}`}>
      {Icon && <Icon size={12} />}
      {TRIGGER_META[type]?.label ?? type}
    </span>
  );
}

export function StepGlyph({ type, size = 15 }: { type: string; size?: number }) {
  const Icon = STEP_ICON[type];
  const color = STEP_META[type]?.color ?? 'var(--text-muted)';
  return Icon ? <Icon size={size} style={{ color }} /> : null;
}

/* -------------------------------------------------------------------- misc */

export function RoleBadge({ role }: { role: string }) {
  const tone = role === 'owner' ? 'accent' : role === 'editor' ? '' : '';
  return <span className={`badge ${tone}`}>{role}</span>;
}

export function Avatar({ name, email, lg }: { name?: string | null; email?: string | null; lg?: boolean }) {
  const source = (name || email || '?').trim();
  const initials = source.includes(' ')
    ? source.split(/\s+/).slice(0, 2).map((s) => s[0]).join('')
    : source.slice(0, 2);
  return <span className={`avatar ${lg ? 'lg' : ''}`}>{initials.toUpperCase()}</span>;
}

export function Meter({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className={`meter ${pct >= 90 ? 'err' : pct >= 70 ? 'warn' : ''}`}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card stat">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      {sub != null && <div className="s">{sub}</div>}
    </div>
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'ok' | 'warn' | 'err'; children: ReactNode }) {
  const Icon = tone === 'err' || tone === 'warn' ? AlertIcon : tone === 'ok' ? Check : Info;
  return (
    <div className={`alert ${tone}`}>
      <Icon size={14} />
      <div>{children}</div>
    </div>
  );
}

export function ErrorText({ error }: { error?: unknown }) {
  if (!error) return null;
  const raw =
    error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
  // Apollo prefixes network/GraphQL noise that means nothing to a reviewer
  const message = raw.replace(/^(GraphQL error:|ApolloError:)\s*/i, '');
  return (
    <div style={{ marginTop: 10 }}>
      <Alert tone="err">{message}</Alert>
    </div>
  );
}

export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon && <div className="glyph">{icon}</div>}
      <h3>{title}</h3>
      {children && <div className="small" style={{ maxWidth: 380, margin: '0 auto' }}>{children}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function Skeleton({ h = 14, w = '100%', style }: { h?: number; w?: string | number; style?: object }) {
  return <div className="skeleton" style={{ height: h, width: w, ...style }} />;
}

export function CopyButton({ value, label = 'Copy', className = 'btn xs ghost' }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
        } catch {
          /* clipboard blocked — nothing useful to show */
        }
      }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
      {done ? 'Copied' : label}
    </button>
  );
}

export function Code({ children, max }: { children: string; max?: number }) {
  return (
    <div className="code-block">
      <pre className="scroll" style={max ? { maxHeight: max } : undefined}>
        {children}
      </pre>
      <CopyButton value={children} label="" className="btn xs" />
    </div>
  );
}

export function Json({ value, max }: { value: unknown; max?: number }) {
  if (value === null || value === undefined) return null;
  return <Code max={max}>{JSON.stringify(value, null, 2)}</Code>;
}

/* ------------------------------------------------------------------- time */

export function relTime(value?: string | null) {
  if (!value) return '—';
  const diff = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.round(diff / 86400)}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function duration(from?: string | null, to?: string | null) {
  if (!from) return '—';
  const end = to ? new Date(to).getTime() : Date.now();
  const s = Math.max(0, (end - new Date(from).getTime()) / 1000);
  if (s < 1) return `${Math.round(s * 1000)}ms`;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/** Ticks once a second so an in-flight step shows a live elapsed timer. */
export function useNow(active: boolean) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}
