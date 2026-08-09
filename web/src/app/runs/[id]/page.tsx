'use client';

import { useMutation, useQuery, useSubscription } from '@apollo/client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ErrorText, Json, StatusBadge, duration, relTime } from '@/components/ui';
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

function RunView() {
  const params = useParams<{ id: string }>();
  const runId = params.id;

  // Overall run status, live.
  const { data: runData, error: runError } = useSubscription(RUN_LIVE, { variables: { runId } });
  // The required subscription: step_runs filtered to one workflow_run_id.
  const { data: stepData, error: stepError } = useSubscription(STEP_RUNS_LIVE, { variables: { runId } });

  const run = runData?.workflow_runs_by_pk;
  const steps: StepRun[] = stepData?.step_runs ?? [];

  if (runError || stepError) return <ErrorText error={runError ?? stepError} />;

  if (!run && steps.length === 0) {
    return (
      <div className="panel">
        <h1>Waiting for the run…</h1>
        <p className="muted small">
          If this never resolves, the run either does not exist or belongs to another organization —
          the subscription simply returns nothing rather than an error.
        </p>
        <Link href="/">Back to workflows</Link>
      </div>
    );
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <Link className="small muted" href={run?.workflow ? `/workflows/${run.workflow.id}` : '/'}>
            ← {run?.workflow?.name ?? 'workflow'}
          </Link>
          <h1 style={{ marginTop: 4 }}>Run</h1>
          <div className="mono muted small">{runId}</div>
        </div>
        <div className="row">
          <span className="badge">{run?.trigger_type ?? '—'}</span>
          <StatusBadge status={run?.status} live />
        </div>
      </div>

      <div className="grid two">
        <div className="panel">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ marginBottom: 0 }}>Live progress</h2>
            <span className="small muted">
              <span className="dot live" style={{ color: 'var(--accent)' }} /> streaming over a GraphQL
              subscription
            </span>
          </div>

          <div className="steplist" style={{ marginTop: 12 }}>
            {steps.map((step) => (
              <StepRunCard key={step.id} step={step} />
            ))}
          </div>
        </div>

        <div>
          <div className="panel">
            <h2>Run detail</h2>
            <dl className="kv">
              <dt>status</dt>
              <dd>{run?.status ?? '—'}</dd>
              <dt>trigger</dt>
              <dd>{run?.trigger_type ?? '—'}</dd>
              <dt>started</dt>
              <dd>{relTime(run?.started_at)}</dd>
              <dt>duration</dt>
              <dd>{duration(run?.started_at, run?.finished_at)}</dd>
            </dl>
            {run?.error && <div className="alert err" style={{ marginTop: 10 }}>{run.error}</div>}
            {run?.input != null && (
              <>
                <h3 style={{ marginTop: 14 }}>Input</h3>
                <Json value={run.input} />
              </>
            )}
          </div>

          <SideEffects runId={runId} />
        </div>
      </div>
    </>
  );
}

function StepRunCard({ step }: { step: StepRun }) {
  const [open, setOpen] = useState(false);
  const active = step.status === 'running' || step.status === 'awaiting_approval';

  return (
    <div className={`step ${active ? 'active' : ''}`}>
      <div className="step-head">
        <span className="step-index">{step.position}</span>
        <strong style={{ flex: 1 }}>{step.name}</strong>
        <span className="badge">{step.type}</span>
        <StatusBadge status={step.status} live />
        <button className="sm ghost" onClick={() => setOpen((v) => !v)}>
          {open ? 'hide' : 'detail'}
        </button>
      </div>

      <div className="row small muted" style={{ marginTop: 6 }}>
        {step.attempt_count > 0 && <span>attempt {step.attempt_count}</span>}
        {step.started_at && <span>· {duration(step.started_at, step.finished_at)}</span>}
        {step.approver && (
          <span>
            · approved by {step.approver.displayName || step.approver.email} {relTime(step.approved_at)}
          </span>
        )}
      </div>

      {step.error && <div className="alert err small" style={{ marginTop: 8 }}>{step.error}</div>}

      {step.status === 'awaiting_approval' && <ApprovalGate step={step} />}

      {open && (
        <>
          {step.output != null && <Json value={step.output} />}
          {step.approval_note && <div className="small muted">note: {step.approval_note}</div>}
        </>
      )}
    </div>
  );
}

function ApprovalGate({ step }: { step: StepRun }) {
  const { role } = useRole();
  const [note, setNote] = useState('');
  const [approve, { loading, error }] = useMutation(APPROVE_STEP);
  const canApprove = role === 'owner' || role === 'editor';

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong style={{ color: 'var(--warn)' }}>Paused — awaiting approval</strong>
        <span className="badge warn">run is paused</span>
      </div>

      {!canApprove ? (
        <p className="muted small" style={{ marginBottom: 0 }}>
          Viewers cannot approve. The <span className="mono">approveStep</span> Action is not exposed
          to the viewer role, and the handler re-checks the approver&apos;s role in this org before
          resuming the run.
        </p>
      ) : (
        <>
          <div className="field" style={{ marginTop: 8 }}>
            <label>Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Looks right" />
          </div>
          <ErrorText error={error} />
          <div className="row">
            <button
              className="primary"
              disabled={loading}
              onClick={() =>
                approve({ variables: { stepRunId: step.id, decision: 'approve', note: note || null } })
              }
            >
              {loading ? 'Resuming…' : 'Approve & resume'}
            </button>
            <button
              className="danger"
              disabled={loading}
              onClick={() =>
                approve({ variables: { stepRunId: step.id, decision: 'reject', note: note || null } })
              }
            >
              Reject
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SideEffects({ runId }: { runId: string }) {
  const { data } = useQuery(RUN_SIDE_EFFECTS, { variables: { runId }, pollInterval: 4000 });
  const artifacts = data?.workflow_artifacts ?? [];
  const notifications = data?.notifications ?? [];
  if (!artifacts.length && !notifications.length) return null;

  return (
    <div className="panel">
      <h2>Side effects</h2>
      {artifacts.map((a: any) => (
        <div key={a.id} style={{ marginBottom: 10 }}>
          <div className="small muted">
            db_write → workflow_artifacts · <span className="mono">{a.key}</span>
          </div>
          <Json value={a.payload} />
        </div>
      ))}
      {notifications.map((n: any) => (
        <div key={n.id} style={{ marginBottom: 8 }}>
          <div className="row small">
            <span className="badge">{n.channel}</span>
            <StatusBadge status={n.status} />
          </div>
          <div className="small">{n.message}</div>
          {n.error && <div className="small muted">{n.error}</div>}
        </div>
      ))}
    </div>
  );
}
