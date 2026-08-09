'use client';

import { useMutation, useQuery, useSubscription } from '@apollo/client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import {
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  Database,
  Lock,
  ShieldCheck,
  X,
} from '@/components/icons';
import {
  Alert,
  ErrorText,
  Json,
  Skeleton,
  StatusBadge,
  StatusGlyph,
  StepGlyph,
  TriggerPill,
  TypePill,
  duration,
  relTime,
  statusTone,
  useNow,
} from '@/components/ui';
import { useRole } from '@/lib/providers';
import { APPROVE_STEP, RUN_LIVE, RUN_SIDE_EFFECTS, STEP_RUNS_LIVE } from '@/lib/queries';

type StepRun = {
  id: string;
  name: string;
  type: string;
  position: number;
  status: string;
  attempt_count: number;
  error: string | null;
  output: unknown;
  approved_at: string | null;
  approval_note: string | null;
  started_at: string | null;
  finished_at: string | null;
  approver: { id: string; displayName: string; email: string } | null;
};

export default function RunPage() {
  return (
    <AppShell>
      <RunView />
    </AppShell>
  );
}

const TONE_COLOR: Record<string, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  err: 'var(--err)',
  accent: 'var(--accent)',
  '': 'var(--text-subtle)',
};

function RunView() {
  const params = useParams<{ id: string }>();
  const runId = params.id;

  // Overall run status, live.
  const { data: runData, error: runError, loading } = useSubscription(RUN_LIVE, { variables: { runId } });
  // The required subscription: step_runs filtered to one workflow_run_id.
  const { data: stepData, error: stepError } = useSubscription(STEP_RUNS_LIVE, { variables: { runId } });

  const run = runData?.workflow_runs_by_pk;
  const steps: StepRun[] = stepData?.step_runs ?? [];

  const live = run?.status === 'running' || run?.status === 'paused';
  useNow(Boolean(live));

  if (runError || stepError) return <ErrorText error={runError ?? stepError} />;

  if (loading && !run && steps.length === 0) {
    return (
      <div className="card pad stack-12">
        <Skeleton h={18} w={220} />
        <Skeleton h={11} w={140} />
        <div style={{ height: 8 }} />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton h={44} key={i} />
        ))}
      </div>
    );
  }

  if (!run && steps.length === 0) {
    return (
      <div className="card pad" style={{ maxWidth: 520 }}>
        <span
          className="brand-mark"
          style={{ width: 34, height: 34, borderRadius: 11, background: 'var(--surface-3)', color: 'var(--text-subtle)' }}
        >
          <Lock size={16} />
        </span>
        <h1 style={{ marginTop: 14 }}>Nothing to show</h1>
        <p className="muted small" style={{ marginTop: 6 }}>
          This run does not exist, or it belongs to an organization you are not a member of. The
          subscription returns an empty result either way — the API never confirms that the id is
          real.
        </p>
        <Link className="btn" href="/runs" style={{ marginTop: 16 }}>
          Back to runs
        </Link>
      </div>
    );
  }

  const total = steps.length;
  const done = steps.filter((s) => ['succeeded', 'skipped', 'failed', 'rejected'].includes(s.status)).length;
  const gate = steps.find((s) => s.status === 'awaiting_approval');

  return (
    <>
      <div className="page-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link className="breadcrumb" href={run?.workflow ? `/workflows/${run.workflow.id}` : '/runs'}>
            <ChevronLeft size={13} />
            {run?.workflow?.name ?? 'Runs'}
          </Link>
          <h1>Run</h1>
          <div className="row wrap" style={{ gap: 8, marginTop: 7 }}>
            <StatusBadge status={run?.status} />
            {run?.trigger_type && <TriggerPill type={run.trigger_type} muted />}
            <span className="tiny subtle tnum">{duration(run?.started_at, run?.finished_at)}</span>
            <span className="tiny subtle mono truncate" style={{ maxWidth: 250 }}>
              {runId}
            </span>
          </div>
        </div>
      </div>

      <div className="grid main-rail">
        <div className="stack-16">
          {gate && <ApprovalPanel step={gate} />}

          <section className="card">
            <div className="card-head">
              <h2 style={{ flex: 1 }}>Live progress</h2>
              <span className="tiny subtle tnum">
                {done} / {total} steps
              </span>
              {live && (
                <span className="badge accent">
                  <span className="dot pulse" />
                  streaming
                </span>
              )}
            </div>

            <div className={`progress ${run?.status === 'running' ? 'indeterminate' : ''}`} style={{ borderRadius: 0 }}>
              <i style={run?.status === 'running' ? undefined : { width: `${total ? (done / total) * 100 : 0}%` }} />
            </div>

            <div className="card-body">
              <div className="chain">
                {steps.map((step) => (
                  <StepRunRow key={step.id} step={step} />
                ))}
              </div>
            </div>
          </section>
        </div>

        <div className="stack-16">
          <section className="card">
            <div className="card-head">
              <h2 style={{ flex: 1 }}>Run detail</h2>
            </div>
            <div className="card-body stack-8">
              <Detail k="Status" v={<StatusBadge status={run?.status} />} />
              <Detail k="Trigger" v={run?.trigger_type ? <TriggerPill type={run.trigger_type} muted /> : '—'} />
              <Detail k="Started" v={<span className="small">{relTime(run?.started_at)}</span>} />
              <Detail
                k="Duration"
                v={<span className="small tnum">{duration(run?.started_at, run?.finished_at)}</span>}
              />
              {run?.error && (
                <div style={{ marginTop: 6 }}>
                  <Alert tone="err">{run.error}</Alert>
                </div>
              )}
              {run?.input != null && (
                <div style={{ marginTop: 10 }}>
                  <div className="label">Input</div>
                  <Json value={run.input} max={180} />
                </div>
              )}
            </div>
          </section>

          <SideEffects runId={runId} />
        </div>
      </div>
    </>
  );
}

function Detail({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="row between" style={{ gap: 12 }}>
      <span className="small muted">{k}</span>
      <span>{v}</span>
    </div>
  );
}

/* ---------------------------------------------------------------- a step */

function StepRunRow({ step }: { step: StepRun }) {
  const [open, setOpen] = useState(false);
  const active = step.status === 'running' || step.status === 'awaiting_approval';
  const tone = statusTone(step.status);
  const color = TONE_COLOR[tone];
  const dead = step.status === 'skipped' || step.status === 'pending';

  return (
    <div className="chain-item">
      <span
        className="chain-node"
        style={{
          color,
          borderColor: tone ? `color-mix(in srgb, ${color} 40%, transparent)` : 'var(--border)',
          boxShadow: active ? `0 0 0 4px color-mix(in srgb, ${color} 14%, transparent)` : undefined,
        }}
      >
        <StatusGlyph status={step.status} size={13} />
      </span>

      <div className="chain-body">
        <div
          className={`step ${step.status === 'running' ? 'active' : ''} ${
            step.status === 'awaiting_approval' ? 'gate' : ''
          } ${dead ? 'dead' : ''}`}
        >
          <button
            className="step-head"
            style={{ width: '100%', background: 'none', border: 0, cursor: 'pointer', font: 'inherit', color: 'inherit', textAlign: 'left' }}
            onClick={() => setOpen((v) => !v)}
          >
            <StepGlyph type={step.type} />
            <span className="step-title truncate" style={{ flex: 1 }}>
              {step.name}
            </span>
            {step.attempt_count > 1 && <span className="badge warn">retry {step.attempt_count}</span>}
            <span className="tiny subtle tnum nowrap">
              {step.started_at ? duration(step.started_at, step.finished_at) : ''}
            </span>
            <StatusBadge status={step.status} plain />
            <ChevronDown
              size={14}
              className="subtle"
              style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .18s' }}
            />
          </button>

          {step.error && (
            <div style={{ padding: '0 11px 11px' }}>
              <Alert tone="err">{step.error}</Alert>
            </div>
          )}

          {step.approver && (
            <div className="row tiny subtle" style={{ padding: '0 11px 10px', gap: 6 }}>
              <Check size={12} style={{ color: 'var(--ok)' }} />
              Approved by {step.approver.displayName || step.approver.email} {relTime(step.approved_at)}
              {step.approval_note ? ` · “${step.approval_note}”` : ''}
            </div>
          )}

          {open && (
            <div className="step-config">
              <div className="row" style={{ gap: 6, marginBottom: 9 }}>
                <TypePill type={step.type} />
                <span className="tiny subtle">position {step.position}</span>
              </div>
              {step.output != null ? (
                <Json value={step.output} max={260} />
              ) : (
                <div className="small subtle">No output recorded for this step.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- approval */

function ApprovalPanel({ step }: { step: StepRun }) {
  const { role } = useRole();
  const [note, setNote] = useState('');
  const [approve, { loading, error }] = useMutation(APPROVE_STEP);
  const canApprove = role === 'owner' || role === 'editor';

  return (
    <section
      className="card rise"
      style={{
        borderColor: 'var(--warn-border)',
        boxShadow: '0 0 0 4px var(--warn-soft)',
      }}
    >
      <div className="card-head" style={{ borderColor: 'var(--warn-border)' }}>
        <ShieldCheck size={16} style={{ color: 'var(--warn)' }} />
        <h2 style={{ flex: 1 }}>Waiting on a human</h2>
        <span className="badge warn">
          <span className="dot pulse" />
          run paused
        </span>
      </div>
      <div className="card-body">
        <p className="small muted">
          The run stopped at <span className="strong" style={{ color: 'var(--text)' }}>{step.name}</span> and
          persisted its whole state. Nothing is polling and no request is held open — approving calls the{' '}
          <span className="mono">approveStep</span> Action, which re-checks your role in this
          organization before resuming the engine from the next step.
        </p>

        {!canApprove ? (
          <div style={{ marginTop: 12 }}>
            <Alert tone="info">
              Viewers cannot approve. The Action is not exposed to the viewer role at all, and the
              handler independently rejects the call.
            </Alert>
          </div>
        ) : (
          <>
            <div className="field" style={{ marginTop: 14 }}>
              <label>Note (optional)</label>
              <input
                className="prose"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Looks right — ship it"
                style={{ fontFamily: 'var(--font-sans)' }}
              />
            </div>
            <ErrorText error={error} />
            <div className="row" style={{ marginTop: 14 }}>
              <button
                className="btn ok"
                disabled={loading}
                onClick={() =>
                  approve({ variables: { stepRunId: step.id, decision: 'approve', note: note || null } })
                }
              >
                <Check size={14} />
                {loading ? 'Resuming…' : 'Approve & resume'}
              </button>
              <button
                className="btn danger"
                disabled={loading}
                onClick={() =>
                  approve({ variables: { stepRunId: step.id, decision: 'reject', note: note || null } })
                }
              >
                <X size={14} />
                Reject
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/* --------------------------------------------------------- side effects */

function SideEffects({ runId }: { runId: string }) {
  const { data } = useQuery(RUN_SIDE_EFFECTS, { variables: { runId }, pollInterval: 4000 });
  const artifacts = data?.workflow_artifacts ?? [];
  const notifications = data?.notifications ?? [];
  if (!artifacts.length && !notifications.length) return null;

  return (
    <section className="card">
      <div className="card-head">
        <h2 style={{ flex: 1 }}>Side effects</h2>
      </div>
      <div className="card-body stack-16">
        {artifacts.map((a: any) => (
          <div key={a.id}>
            <div className="row tiny subtle" style={{ gap: 6, marginBottom: 6 }}>
              <Database size={12} style={{ color: 'var(--type-db)' }} />
              workflow_artifacts · <span className="mono">{a.key}</span>
            </div>
            <Json value={a.payload} max={200} />
          </div>
        ))}
        {notifications.map((n: any) => (
          <div key={n.id}>
            <div className="row" style={{ gap: 6, marginBottom: 6 }}>
              <Bell size={12} style={{ color: 'var(--type-notify)' }} />
              <span className="tiny subtle">{n.channel} · delivered by event trigger</span>
              <span className="spacer" />
              <StatusBadge status={n.status} plain />
            </div>
            <div className="small" style={{ lineHeight: 1.5 }}>
              {n.message}
            </div>
            {n.error && <div className="tiny subtle" style={{ marginTop: 4 }}>{n.error}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
