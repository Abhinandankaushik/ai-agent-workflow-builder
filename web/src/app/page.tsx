'use client';

import { useMutation, useQuery } from '@apollo/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ErrorText, Json, Meter, StatusBadge, relTime } from '@/components/ui';
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
    pollInterval: 6000,
  });

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h1>Workflows</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Everything on this page is scoped to your organization by Hasura row permissions.
          </p>
        </div>
      </div>

      <div className="grid two">
        <div>
          {error && <ErrorText error={error} />}
          {loading && !data && <div className="panel muted">Loading workflows…</div>}

          {data?.workflows.length === 0 && (
            <div className="panel muted">
              No workflows yet{canEdit ? ' — create one on the right.' : '.'}
            </div>
          )}

          <div className="grid">
            {data?.workflows.map((wf) => (
              <WorkflowCard key={wf.id} workflow={wf} onRan={() => refetch()} />
            ))}
          </div>
        </div>

        <div>
          <UsagePanel />
          {canEdit && <NewWorkflowPanel onCreated={() => refetch()} />}
          {canEdit && <DatabaseEventPanel />}
          {!canEdit && (
            <div className="panel">
              <h2>Viewer access</h2>
              <p className="muted small" style={{ marginBottom: 0 }}>
                You can read this org&apos;s workflows and run history. Starting a run is blocked at
                the Hasura Action permission, not just hidden in this UI.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------- workflow card

function WorkflowCard({ workflow, onRan }: { workflow: Workflow; onRan: () => void }) {
  const router = useRouter();
  const { role } = useRole();
  const canRun = role === 'owner' || role === 'editor';
  const [message, setMessage] = useState('This app keeps crashing and I am furious about it.');
  const [showRun, setShowRun] = useState(false);
  const [trigger, { loading, error }] = useMutation(TRIGGER_WORKFLOW_RUN);

  const latest = workflow.runs[0];

  async function run() {
    const res = await trigger({ variables: { workflowId: workflow.id, input: { message } } });
    onRan();
    const runId = res.data?.triggerWorkflowRun?.run_id;
    if (runId) router.push(`/runs/${runId}`);
  }

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>
            <Link href={`/workflows/${workflow.id}`}>{workflow.name}</Link>
          </h2>
          <div className="muted small">{workflow.description || 'No description'}</div>
        </div>
        <StatusBadge status={workflow.latest_run_status} />
      </div>

      <div className="row small muted" style={{ marginTop: 10 }}>
        <span>{workflow.steps.length} steps</span>
        <span>·</span>
        <span>{workflow.run_count} runs</span>
        {latest && (
          <>
            <span>·</span>
            <span>
              last {latest.trigger_type} run {relTime(latest.created_at)}
            </span>
          </>
        )}
      </div>

      <div className="row small" style={{ marginTop: 8 }}>
        {workflow.steps.map((s) => (
          <span key={s.id} className="badge">
            {s.type}
          </span>
        ))}
      </div>

      <div className="row small" style={{ marginTop: 8 }}>
        <span className="muted">triggers:</span>
        {workflow.triggers.length === 0 && <span className="muted">none</span>}
        {workflow.triggers.map((t) => (
          <span key={t.id} className={`badge ${t.is_active ? 'run' : ''}`}>
            {t.type}
          </span>
        ))}
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <Link className="btn" href={`/workflows/${workflow.id}`}>
          Open builder
        </Link>
        {latest && (
          <Link className="btn" href={`/runs/${latest.id}`}>
            Latest run
          </Link>
        )}
        {/* Hidden for viewers here, and independently rejected by the Action's
            permission if a viewer ever calls the mutation directly. */}
        {canRun && (
          <button className="primary" onClick={() => setShowRun((v) => !v)}>
            Run
          </button>
        )}
      </div>

      {showRun && canRun && (
        <div style={{ marginTop: 10 }}>
          <div className="field">
            <label>Run input — available to steps as {'{{run.input.message}}'}</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
          <ErrorText error={error} />
          <button className="primary" onClick={run} disabled={loading}>
            {loading ? 'Starting…' : 'Start run'}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- side panels

function UsagePanel() {
  const { orgId } = useRole();
  const { data } = useQuery(ORG_USAGE, { variables: { orgId }, skip: !orgId, pollInterval: 6000 });
  const usage = data?.org_usage?.[0];
  if (!usage) return null;

  return (
    <div className="panel">
      <h2>Usage this period</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        From the <span className="mono">org_usage</span> Postgres view.
      </p>
      <div className="row small" style={{ justifyContent: 'space-between' }}>
        <span className="muted">runs consumed</span>
        <span>
          {usage.quota_used} / {usage.quota_limit}
        </span>
      </div>
      <Meter used={usage.quota_used} limit={usage.quota_limit} />
      <dl className="kv" style={{ marginTop: 12 }}>
        <dt>runs started</dt>
        <dd>{usage.runs_this_period}</dd>
        <dt>completed</dt>
        <dd>{usage.completed_runs}</dd>
        <dt>failed</dt>
        <dd>{usage.failed_runs}</dd>
        <dt>paused</dt>
        <dd>{usage.paused_runs}</dd>
        <dt>avg duration</dt>
        <dd>{usage.avg_run_seconds}s</dd>
        <dt>llm calls</dt>
        <dd>{usage.llm_calls_this_period}</dd>
      </dl>
    </div>
  );
}

function NewWorkflowPanel({ onCreated }: { onCreated: () => void }) {
  const { orgId } = useRole();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [create, { loading, error }] = useMutation(CREATE_WORKFLOW);
  const router = useRouter();

  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await create({ variables: { orgId, name, description } });
        setName('');
        setDescription('');
        onCreated();
        const id = res.data?.insert_workflows_one?.id;
        if (id) router.push(`/workflows/${id}`);
      }}
    >
      <h2>New workflow</h2>
      <div className="field">
        <label>Name</label>
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Support triage" />
      </div>
      <div className="field">
        <label>Description</label>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <ErrorText error={error} />
      <button className="primary" disabled={loading}>
        {loading ? 'Creating…' : 'Create workflow'}
      </button>
    </form>
  );
}

function DatabaseEventPanel() {
  const { orgId } = useRole();
  const [payload, setPayload] = useState('{\n  "message": "Everything broke after the update!"\n}');
  const [insert, { loading, error, data }] = useMutation(INSERT_WATCHED_EVENT);
  const [parseError, setParseError] = useState<string | null>(null);

  return (
    <div className="panel">
      <h2>Fire a database event</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Inserts into <span className="mono">watched_events</span>. A Hasura Event Trigger picks the
        row up and starts every workflow in this org with a matching{' '}
        <span className="mono">database_event</span> trigger — no button on a workflow involved.
      </p>
      <div className="field">
        <label>Payload</label>
        <textarea value={payload} onChange={(e) => setPayload(e.target.value)} />
      </div>
      {parseError && <ErrorText error={parseError} />}
      <ErrorText error={error} />
      {data && <div className="alert ok small">Event inserted — watch the workflow&apos;s runs.</div>}
      <button
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
        {loading ? 'Inserting…' : 'Insert watched_events row'}
      </button>
      {data && <Json value={data} />}
    </div>
  );
}
