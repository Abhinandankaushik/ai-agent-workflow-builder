'use client';

import { useMutation, useQuery } from '@apollo/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import {
  ChevronRight,
  Database,
  Flow,
  Gauge,
  Play,
  Plus,
  Sparkles,
} from '@/components/icons';
import {
  Alert,
  Empty,
  ErrorText,
  Meter,
  Skeleton,
  Stat,
  StatusBadge,
  StepGlyph,
  TriggerPill,
  relTime,
} from '@/components/ui';
import { useRole } from '@/lib/providers';
import {
  CREATE_WORKFLOW,
  INSERT_WATCHED_EVENT,
  ORG_USAGE,
  ORG_WORKFLOWS,
  TRIGGER_WORKFLOW_RUN,
} from '@/lib/queries';

export default function DashboardPage() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}

type Workflow = {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
  latest_run_status: string | null;
  run_count: number;
  steps: Array<{ id: string; name: string; type: string; position: number }>;
  triggers: Array<{ id: string; type: string; is_active: boolean }>;
  runs: Array<{ id: string; status: string; trigger_type: string; created_at: string }>;
};

function Dashboard() {
  const { orgId, role } = useRole();
  const canEdit = role === 'owner' || role === 'editor';

  const { data, loading, error, refetch } = useQuery<{ workflows: Workflow[] }>(ORG_WORKFLOWS, {
    variables: { orgId },
    skip: !orgId,
    pollInterval: 8000,
  });
  const { data: usageData } = useQuery(ORG_USAGE, { variables: { orgId }, skip: !orgId, pollInterval: 6000 });
  const usage = usageData?.org_usage?.[0];

  const [composing, setComposing] = useState(false);

  return (
    <>
      <div className="page-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>Workflows</h1>
          <p className="muted small">
            Every workflow, run and quota figure on this page is scoped to your organization by Hasura
            row permissions — not by this UI.
          </p>
        </div>
        {canEdit && (
          <button className="btn primary" onClick={() => setComposing((v) => !v)}>
            <Plus size={15} />
            New workflow
          </button>
        )}
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat
          label="Runs this period"
          value={usage ? usage.runs_this_period : <Skeleton h={24} w={44} />}
          sub={`${usage?.paused_runs ?? 0} awaiting approval`}
        />
        <Stat
          label="Completed"
          value={usage ? usage.completed_runs : <Skeleton h={24} w={44} />}
          sub={`${usage?.failed_runs ?? 0} failed`}
        />
        <Stat
          label="Avg duration"
          value={usage ? `${usage.avg_run_seconds}s` : <Skeleton h={24} w={60} />}
          sub="across finished runs"
        />
        <Stat
          label="LLM calls"
          value={usage ? usage.llm_calls_this_period : <Skeleton h={24} w={44} />}
          sub="this quota period"
        />
      </div>

      <div className="grid main-rail">
        <div className="stack-16">
          {composing && canEdit && <NewWorkflowCard onDone={() => { setComposing(false); refetch(); }} />}

          {error && <ErrorText error={error} />}

          {loading && !data && (
            <div className="stack-16">
              {[0, 1].map((i) => (
                <div className="card pad" key={i}>
                  <Skeleton h={16} w={190} />
                  <div style={{ height: 10 }} />
                  <Skeleton h={11} w="70%" />
                  <div style={{ height: 18 }} />
                  <Skeleton h={30} />
                </div>
              ))}
            </div>
          )}

          {data?.workflows.length === 0 && (
            <div className="card">
              <Empty
                icon={<Flow size={20} />}
                title="No workflows yet"
                action={
                  canEdit ? (
                    <button className="btn primary" onClick={() => setComposing(true)}>
                      <Plus size={15} />
                      Create your first workflow
                    </button>
                  ) : undefined
                }
              >
                {canEdit
                  ? 'Chain an LLM call, a branch and an approval gate, then start it four different ways.'
                  : 'Nothing has been created in this organization yet.'}
              </Empty>
            </div>
          )}

          {data?.workflows.map((wf, i) => (
            <WorkflowCard key={wf.id} workflow={wf} index={i} onRan={() => refetch()} />
          ))}
        </div>

        <div className="stack-16">
          <QuotaCard usage={usage} />
          {canEdit ? <DatabaseEventCard /> : <ViewerCard />}
        </div>
      </div>
    </>
  );
}

/* --------------------------------------------------------------- workflow */

function WorkflowCard({
  workflow,
  index,
  onRan,
}: {
  workflow: Workflow;
  index: number;
  onRan: () => void;
}) {
  const router = useRouter();
  const { role } = useRole();
  const canRun = role === 'owner' || role === 'editor';
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('The app keeps crashing and I am furious about it.');
  const [trigger, { loading, error }] = useMutation(TRIGGER_WORKFLOW_RUN);

  const latest = workflow.runs[0];

  async function run() {
    const res = await trigger({ variables: { workflowId: workflow.id, input: { message } } });
    onRan();
    const runId = res.data?.triggerWorkflowRun?.run_id;
    if (runId) router.push(`/runs/${runId}`);
  }

  return (
    <article
      className="card hover rise"
      style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
    >
      <div className="card-body" style={{ paddingBottom: 14 }}>
        <div className="row between" style={{ alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <Link href={`/workflows/${workflow.id}`} className="row" style={{ gap: 7 }}>
              <h2 className="truncate">{workflow.name}</h2>
              <ChevronRight size={14} className="subtle" />
            </Link>
            <p className="muted small" style={{ marginTop: 3 }}>
              {workflow.description || 'No description'}
            </p>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {!workflow.is_active && <span className="badge">paused</span>}
            <StatusBadge status={workflow.latest_run_status} />
          </div>
        </div>

        <div className="row wrap" style={{ gap: 5, marginTop: 14 }}>
          {workflow.steps.map((s, i) => (
            <span key={s.id} className="row" style={{ gap: 5 }}>
              {i > 0 && <ChevronRight size={12} className="subtle" style={{ opacity: 0.55 }} />}
              <span
                className="row"
                title={`${s.name} · ${s.type}`}
                style={{
                  gap: 5,
                  padding: '3px 8px 3px 6px',
                  borderRadius: 999,
                  border: '1px solid var(--border)',
                  background: 'var(--surface-2)',
                  fontSize: 11.5,
                  color: 'var(--text-muted)',
                }}
              >
                <StepGlyph type={s.type} size={13} />
                <span className="truncate" style={{ maxWidth: 110 }}>
                  {s.name}
                </span>
              </span>
            </span>
          ))}
          {workflow.steps.length === 0 && <span className="small subtle">No steps configured</span>}
        </div>
      </div>

      <div
        className="row between"
        style={{ padding: '10px 18px', borderTop: '1px solid var(--border)', gap: 10, flexWrap: 'wrap' }}
      >
        <div className="row wrap" style={{ gap: 5 }}>
          {workflow.triggers.map((t) => (
            <TriggerPill key={t.id} type={t.type} muted={!t.is_active} />
          ))}
          {workflow.triggers.length === 0 && <span className="tiny subtle">no triggers</span>}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="tiny subtle nowrap">
            {workflow.run_count} run{workflow.run_count === 1 ? '' : 's'}
            {latest ? ` · ${relTime(latest.created_at)}` : ''}
          </span>
          {latest && (
            <Link className="btn sm" href={`/runs/${latest.id}`}>
              Latest
            </Link>
          )}
          <Link className="btn sm" href={`/workflows/${workflow.id}`}>
            Open
          </Link>
          {/* Hidden for viewers here, and independently rejected by the Action's
              permission if a viewer ever calls the mutation directly. */}
          {canRun && (
            <button className="btn primary sm" onClick={() => setOpen((v) => !v)}>
              <Play size={12} />
              Run
            </button>
          )}
        </div>
      </div>

      {open && canRun && (
        <div style={{ padding: 18, borderTop: '1px solid var(--border)', animation: 'reveal .2s var(--ease)' }}>
          <div className="field">
            <label>Run input</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
            <div className="hint">
              Reachable from any step as <span className="mono">{'{{run.input.message}}'}</span>
            </div>
          </div>
          <ErrorText error={error} />
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={run} disabled={loading}>
              <Play size={13} />
              {loading ? 'Starting…' : 'Start run'}
            </button>
            <button className="btn ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------- rail */

function QuotaCard({ usage }: { usage: any }) {
  return (
    <section className="card">
      <div className="card-head">
        <Gauge size={15} className="subtle" />
        <h2 style={{ flex: 1 }}>Usage this period</h2>
      </div>
      <div className="card-body">
        {!usage ? (
          <Skeleton h={70} />
        ) : (
          <>
            <div className="row between" style={{ marginBottom: 7 }}>
              <span className="small muted">Runs consumed</span>
              <span className="small tnum strong">
                {usage.quota_used} / {usage.quota_limit}
              </span>
            </div>
            <Meter used={usage.quota_used} limit={usage.quota_limit} />
            <div className="tiny subtle" style={{ marginTop: 7 }}>
              Checked before a run is created and consumed atomically on completion.
            </div>

            <div className="grid cols-2" style={{ gap: 10, marginTop: 16 }}>
              {[
                ['Started', usage.runs_this_period],
                ['Completed', usage.completed_runs],
                ['Paused', usage.paused_runs],
                ['Failed', usage.failed_runs],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <div className="tiny subtle">{k}</div>
                  <div className="strong tnum" style={{ fontSize: 15 }}>
                    {v as number}
                  </div>
                </div>
              ))}
            </div>
            <div className="tiny subtle" style={{ marginTop: 14 }}>
              Source: the <span className="mono">org_usage</span> Postgres view.
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function ViewerCard() {
  return (
    <section className="card pad">
      <h2>Viewer access</h2>
      <p className="muted small" style={{ marginTop: 6 }}>
        You can read this organization&apos;s workflows and run history. Starting a run and clearing an
        approval gate are blocked at the Hasura Action permission and re-checked in the handler — not
        merely hidden here.
      </p>
    </section>
  );
}

function NewWorkflowCard({ onDone }: { onDone: () => void }) {
  const { orgId } = useRole();
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [create, { loading, error }] = useMutation(CREATE_WORKFLOW);

  return (
    <form
      className="card pad rise"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await create({ variables: { orgId, name, description } });
        onDone();
        const id = res.data?.insert_workflows_one?.id;
        if (id) router.push(`/workflows/${id}`);
      }}
    >
      <div className="row" style={{ gap: 9, marginBottom: 14 }}>
        <Sparkles size={16} style={{ color: 'var(--accent)' }} />
        <h2 style={{ flex: 1 }}>New workflow</h2>
      </div>
      <div className="grid cols-2" style={{ gap: 12 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Name</label>
          <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Support ticket triage" />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does it do?" />
        </div>
      </div>
      <ErrorText error={error} />
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn primary" disabled={loading || !name}>
          {loading ? 'Creating…' : 'Create & open builder'}
        </button>
        <button type="button" className="btn ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function DatabaseEventCard() {
  const { orgId } = useRole();
  const [payload, setPayload] = useState('{\n  "message": "Everything broke after the update!"\n}');
  const [insert, { loading, error, data }] = useMutation(INSERT_WATCHED_EVENT);
  const [parseError, setParseError] = useState<string | null>(null);

  return (
    <section className="card">
      <div className="card-head">
        <Database size={15} className="subtle" />
        <h2 style={{ flex: 1 }}>Fire a database event</h2>
      </div>
      <div className="card-body">
        <p className="muted small" style={{ marginBottom: 12 }}>
          Inserts a row into <span className="mono">watched_events</span>. A Hasura Event Trigger picks
          it up and starts every workflow in this org with a matching{' '}
          <span className="mono">database_event</span> trigger — no button on a workflow involved.
        </p>
        <div className="field" style={{ margin: 0 }}>
          <label>Payload</label>
          <textarea value={payload} onChange={(e) => setPayload(e.target.value)} rows={4} />
        </div>
        {parseError && <ErrorText error={parseError} />}
        <ErrorText error={error} />
        {data && (
          <div style={{ marginTop: 10 }}>
            <Alert tone="ok">
              Event inserted — the new run will show up in{' '}
              <Link href="/runs" style={{ color: 'inherit', textDecoration: 'underline' }}>
                Runs
              </Link>{' '}
              on its own.
            </Alert>
          </div>
        )}
        <button
          className="btn block"
          style={{ marginTop: 12 }}
          disabled={loading}
          onClick={async () => {
            setParseError(null);
            try {
              const parsed = JSON.parse(payload);
              await insert({ variables: { orgId, source: 'support_inbox', payload: parsed } });
            } catch (err) {
              setParseError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          <Database size={14} />
          {loading ? 'Inserting…' : 'Insert watched_events row'}
        </button>
      </div>
    </section>
  );
}
