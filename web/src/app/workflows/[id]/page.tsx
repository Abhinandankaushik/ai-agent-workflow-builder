'use client';

import { useMutation, useQuery } from '@apollo/client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ErrorText, StatusBadge, relTime } from '@/components/ui';
import { GRAPHQL_HTTP } from '@/lib/nhost';
import { useRole } from '@/lib/providers';
import {
  ADD_TRIGGER,
  DELETE_TRIGGER,
  DELETE_WORKFLOW,
  SAVE_WORKFLOW,
  TRIGGER_WORKFLOW_RUN,
  WORKFLOW_DETAIL,
  WORKFLOW_RUNS,
  WORKFLOW_WEBHOOKS,
} from '@/lib/queries';

const STEP_TYPES = [
  'llm_call',
  'http_request',
  'conditional_branch',
  'approval_gate',
  'db_write',
  'notify',
] as const;

type StepType = (typeof STEP_TYPES)[number];

/** Layer 2, mirrored in the UI. The authoritative check is in Hasura + Postgres. */
const OWNER_ONLY_STEPS: StepType[] = ['db_write', 'notify'];
const OWNER_ONLY_TRIGGERS = ['webhook'];

const DEFAULT_CONFIG: Record<StepType, Record<string, unknown>> = {
  llm_call: {
    model: 'llama-3.3-70b-versatile',
    temperature: 0,
    max_tokens: 300,
    system:
      'You are a triage assistant. Reply with STRICT JSON only: {"sentiment":"POSITIVE"|"NEGATIVE","urgency":"low"|"high","summary":"<one sentence>"}',
    prompt: 'Classify this customer message:\n\n"{{run.input.message}}"',
    parse_json: true,
  },
  http_request: {
    method: 'GET',
    url: 'https://api.github.com/repos/hasura/graphql-engine',
    headers: { accept: 'application/vnd.github+json' },
    parse_json: true,
  },
  conditional_branch: {
    left: '{{prev.output.json.sentiment}}',
    operator: 'equals',
    right: 'NEGATIVE',
    if_true: { action: 'continue' },
    if_false: { action: 'skip_to', position: 3 },
  },
  approval_gate: {
    approver_role: 'editor',
    message: 'Review the result before it is written and announced.',
  },
  db_write: {
    key: 'triage_result',
    payload: { summary: '{{prev.output.json.summary}}' },
  },
  notify: {
    channel: 'slack',
    message: 'Workflow finished: {{prev.output.json.summary}}',
  },
};

type Step = { id?: string; name: string; type: StepType; position: number; config: unknown };
type Trigger = {
  id: string;
  type: string;
  is_active: boolean;
  cron: string | null;
  config: Record<string, unknown>;
  last_fired_at: string | null;
};

export default function WorkflowPage() {
  return (
    <AppShell>
      <Builder />
    </AppShell>
  );
}

function Builder() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { role } = useRole();
  const isOwner = role === 'owner';
  const canEdit = isOwner || role === 'editor';

  const { data, loading, error, refetch } = useQuery(WORKFLOW_DETAIL, {
    variables: { id: params.id },
  });

  const workflow = data?.workflows_by_pk;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [steps, setSteps] = useState<Step[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!workflow) return;
    setName(workflow.name);
    setDescription(workflow.description);
    setIsActive(workflow.is_active);
    setSteps(
      workflow.steps.map((s: any) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        position: s.position,
        config: s.config,
      })),
    );
    setDirty(false);
  }, [workflow]);

  const [save, { loading: saving, error: saveError }] = useMutation(SAVE_WORKFLOW);
  const [removeWorkflow] = useMutation(DELETE_WORKFLOW);

  if (loading && !data) return <div className="panel muted">Loading workflow…</div>;
  if (error) return <ErrorText error={error} />;
  if (!workflow) {
    return (
      <div className="panel">
        <h1>Not found</h1>
        <p className="muted">
          This workflow does not exist, or it belongs to an organization you are not a member of.
          Hasura returns the same empty result either way.
        </p>
        <Link href="/">Back to workflows</Link>
      </div>
    );
  }

  function mutateSteps(next: Step[]) {
    setSteps(next.map((s, i) => ({ ...s, position: i })));
    setDirty(true);
    setSaved(false);
  }

  async function onSave() {
    await save({
      variables: {
        id: workflow.id,
        name,
        description,
        isActive,
        steps: steps.map((s, i) => ({
          workflow_id: workflow.id,
          name: s.name,
          type: s.type,
          position: i,
          config: s.config,
        })),
      },
    });
    setDirty(false);
    setSaved(true);
    await refetch();
  }

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <Link className="small muted" href="/">
            ← all workflows
          </Link>
          <h1 style={{ marginTop: 4 }}>{workflow.name}</h1>
        </div>
        <div className="row">
          <StatusBadge status={workflow.latest_run_status} />
          {canEdit && <RunButton workflowId={workflow.id} />}
        </div>
      </div>

      <div className="grid two">
        <div>
          <div className="panel">
            <h2>Steps</h2>
            <p className="muted small" style={{ marginTop: 0 }}>
              Executed top to bottom. Reference earlier output with{' '}
              <span className="mono">{'{{prev.output.…}}'}</span>,{' '}
              <span className="mono">{'{{steps.<name>.output.…}}'}</span> or{' '}
              <span className="mono">{'{{run.input.…}}'}</span>.
            </p>

            <div className="steplist">
              {steps.map((step, index) => (
                <StepEditor
                  key={index}
                  step={step}
                  index={index}
                  total={steps.length}
                  editable={canEdit}
                  isOwner={isOwner}
                  onChange={(next) => mutateSteps(steps.map((s, i) => (i === index ? next : s)))}
                  onMove={(delta) => {
                    const target = index + delta;
                    if (target < 0 || target >= steps.length) return;
                    const next = [...steps];
                    [next[index], next[target]] = [next[target], next[index]];
                    mutateSteps(next);
                  }}
                  onDelete={() => mutateSteps(steps.filter((_, i) => i !== index))}
                />
              ))}
              {steps.length === 0 && <div className="muted small">No steps yet.</div>}
            </div>

            {canEdit && (
              <div className="row" style={{ marginTop: 12 }}>
                <span className="muted small">add step:</span>
                {STEP_TYPES.map((type) => {
                  const blocked = OWNER_ONLY_STEPS.includes(type) && !isOwner;
                  return (
                    <button
                      key={type}
                      className="sm"
                      disabled={blocked}
                      title={blocked ? 'Only an organization owner can add this step type' : undefined}
                      onClick={() =>
                        mutateSteps([
                          ...steps,
                          {
                            name: `${type} ${steps.length + 1}`,
                            type,
                            position: steps.length,
                            config: DEFAULT_CONFIG[type],
                          },
                        ])
                      }
                    >
                      {type}
                      {blocked ? ' 🔒' : ''}
                    </button>
                  );
                })}
              </div>
            )}

            {canEdit && (
              <>
                <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '14px 0' }} />
                <div className="field">
                  <label>Name</label>
                  <input
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setDirty(true);
                    }}
                  />
                </div>
                <div className="field">
                  <label>Description</label>
                  <input
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      setDirty(true);
                    }}
                  />
                </div>
                <div className="row">
                  <label style={{ margin: 0 }}>
                    <input
                      type="checkbox"
                      style={{ width: 'auto', marginRight: 6 }}
                      checked={isActive}
                      onChange={(e) => {
                        setIsActive(e.target.checked);
                        setDirty(true);
                      }}
                    />
                    active
                  </label>
                  <span className="spacer" />
                  {saved && !dirty && <span className="small" style={{ color: 'var(--ok)' }}>saved</span>}
                  <button className="primary" onClick={onSave} disabled={saving || !dirty}>
                    {saving ? 'Saving…' : 'Save workflow'}
                  </button>
                </div>
                <ErrorText error={saveError} />
              </>
            )}
          </div>

          {isOwner && (
            <div className="panel">
              <h2>Danger zone</h2>
              <button
                className="danger"
                onClick={async () => {
                  await removeWorkflow({ variables: { id: workflow.id } });
                  router.push('/');
                }}
              >
                Delete workflow
              </button>
            </div>
          )}
        </div>

        <div>
          <TriggerPanel
            workflowId={workflow.id}
            triggers={workflow.triggers}
            isOwner={isOwner}
            canEdit={canEdit}
            onChanged={() => refetch()}
          />
          <RunHistory workflowId={workflow.id} />
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ steps

function StepEditor({
  step,
  index,
  total,
  editable,
  isOwner,
  onChange,
  onMove,
  onDelete,
}: {
  step: Step;
  index: number;
  total: number;
  editable: boolean;
  isOwner: boolean;
  onChange: (next: Step) => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState(() => JSON.stringify(step.config, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const locked = OWNER_ONLY_STEPS.includes(step.type) && !isOwner;

  useEffect(() => {
    setRaw(JSON.stringify(step.config, null, 2));
  }, [step.config]);

  return (
    <div className="step">
      <div className="step-head">
        <span className="step-index">{index}</span>
        <input
          style={{ flex: 1 }}
          value={step.name}
          disabled={!editable || locked}
          onChange={(e) => onChange({ ...step, name: e.target.value })}
        />
        <span className="badge">{step.type}</span>
        {locked && <span className="badge warn">owner only</span>}
        <button className="sm ghost" onClick={() => setOpen((v) => !v)}>
          {open ? 'hide' : 'config'}
        </button>
        {editable && !locked && (
          <>
            <button className="sm ghost" onClick={() => onMove(-1)} disabled={index === 0}>
              ↑
            </button>
            <button className="sm ghost" onClick={() => onMove(1)} disabled={index === total - 1}>
              ↓
            </button>
            <button className="sm danger" onClick={onDelete}>
              ✕
            </button>
          </>
        )}
      </div>

      {open && (
        <div style={{ marginTop: 8 }}>
          <label>config (JSON)</label>
          <textarea
            value={raw}
            disabled={!editable || locked}
            onChange={(e) => {
              setRaw(e.target.value);
              try {
                onChange({ ...step, config: JSON.parse(e.target.value) });
                setJsonError(null);
              } catch (err) {
                setJsonError(err instanceof Error ? err.message : String(err));
              }
            }}
            style={{ minHeight: 160 }}
          />
          {jsonError && <div className="small" style={{ color: 'var(--err)' }}>{jsonError}</div>}
        </div>
      )}
    </div>
  );
}

// --------------------------------------------------------------- triggers

function TriggerPanel({
  workflowId,
  triggers,
  isOwner,
  canEdit,
  onChanged,
}: {
  workflowId: string;
  triggers: Trigger[];
  isOwner: boolean;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [add, { loading, error }] = useMutation(ADD_TRIGGER);
  const [remove] = useMutation(DELETE_TRIGGER);
  const { data: secrets } = useQuery(WORKFLOW_WEBHOOKS, {
    variables: { id: workflowId },
    skip: !isOwner,
  });

  const secretFor = (id: string) =>
    secrets?.workflow_triggers?.find((t: any) => t.id === id)?.webhook_secret as string | undefined;

  return (
    <div className="panel">
      <h2>Triggers</h2>
      <div className="grid" style={{ gap: 8 }}>
        {triggers.map((t) => (
          <div key={t.id} className="step">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="row">
                <span className={`badge ${t.is_active ? 'run' : ''}`}>{t.type}</span>
                {t.cron && <span className="mono">{t.cron}</span>}
              </span>
              <span className="row small muted">
                {t.last_fired_at ? `fired ${relTime(t.last_fired_at)}` : 'never fired'}
                {isOwner && (
                  <button className="sm danger" onClick={async () => { await remove({ variables: { id: t.id } }); onChanged(); }}>
                    ✕
                  </button>
                )}
              </span>
            </div>
            {t.type === 'webhook' && secretFor(t.id) && (
              <WebhookRecipe triggerId={t.id} secret={secretFor(t.id)!} />
            )}
            {t.type === 'webhook' && !isOwner && (
              <div className="small muted" style={{ marginTop: 6 }}>
                The webhook secret is a column-level owner-only field.
              </div>
            )}
          </div>
        ))}
        {triggers.length === 0 && <div className="muted small">No triggers.</div>}
      </div>

      {canEdit && (
        <div className="row" style={{ marginTop: 12 }}>
          <span className="muted small">add:</span>
          {['manual', 'webhook', 'scheduled', 'database_event'].map((type) => {
            const blocked = OWNER_ONLY_TRIGGERS.includes(type) && !isOwner;
            return (
              <button
                key={type}
                className="sm"
                disabled={blocked || loading}
                title={blocked ? 'Only an owner can create an inbound webhook trigger' : undefined}
                onClick={async () => {
                  await add({
                    variables: {
                      object: {
                        workflow_id: workflowId,
                        type,
                        cron: type === 'scheduled' ? '*/15 * * * *' : null,
                        config: type === 'database_event' ? { source: 'support_inbox' } : {},
                      },
                    },
                  });
                  onChanged();
                }}
              >
                {type}
                {blocked ? ' 🔒' : ''}
              </button>
            );
          })}
        </div>
      )}
      <ErrorText error={error} />
    </div>
  );
}

function WebhookRecipe({ triggerId, secret }: { triggerId: string; secret: string }) {
  const body = JSON.stringify({
    query:
      'mutation($t:uuid!,$s:String!,$p:jsonb){triggerWorkflowWebhook(trigger_id:$t,secret:$s,payload:$p){run_id status}}',
    variables: { t: triggerId, s: secret, p: { message: 'Inbound from an external system' } },
  });
  const curl = `curl -X POST ${GRAPHQL_HTTP} \\\n  -H 'content-type: application/json' \\\n  -d '${body}'`;
  return (
    <div style={{ marginTop: 8 }}>
      <div className="small muted">Unauthenticated inbound endpoint (secret-verified in the handler):</div>
      <pre className="mono">{curl}</pre>
      <button className="sm" onClick={() => navigator.clipboard.writeText(curl)}>
        copy curl
      </button>
    </div>
  );
}

// ------------------------------------------------------------- run history

function RunButton({ workflowId }: { workflowId: string }) {
  const router = useRouter();
  const [trigger, { loading, error }] = useMutation(TRIGGER_WORKFLOW_RUN);
  return (
    <>
      <button
        className="primary"
        disabled={loading}
        onClick={async () => {
          const res = await trigger({
            variables: {
              workflowId,
              input: { message: 'This app keeps crashing and I am furious about it.' },
            },
          });
          const id = res.data?.triggerWorkflowRun?.run_id;
          if (id) router.push(`/runs/${id}`);
        }}
      >
        {loading ? 'Running…' : 'Run'}
      </button>
      {error && <ErrorText error={error} />}
    </>
  );
}

function RunHistory({ workflowId }: { workflowId: string }) {
  const { data } = useQuery(WORKFLOW_RUNS, { variables: { workflowId }, pollInterval: 5000 });
  const runs = data?.workflow_runs ?? [];
  return (
    <div className="panel">
      <h2>Recent runs</h2>
      {runs.length === 0 && <div className="muted small">No runs yet.</div>}
      {runs.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>status</th>
              <th>trigger</th>
              <th>when</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {runs.map((run: any) => (
              <tr key={run.id}>
                <td>
                  <StatusBadge status={run.status} live />
                </td>
                <td className="small">{run.trigger_type}</td>
                <td className="small muted">{relTime(run.created_at)}</td>
                <td>
                  <Link className="small" href={`/runs/${run.id}`}>
                    open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
