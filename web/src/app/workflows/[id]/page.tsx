'use client';

import { useMutation, useQuery } from '@apollo/client';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ConfigEditor, JsonArea } from '@/components/StepConfig';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  Lock,
  Play,
  Plus,
  STEP_ICON,
  TRIGGER_ICON,
  Trash,
  Webhook,
} from '@/components/icons';
import {
  Alert,
  CopyButton,
  Empty,
  ErrorText,
  STEP_META,
  Skeleton,
  StatusBadge,
  StepGlyph,
  TRIGGER_META,
  TriggerPill,
  TypePill,
  relTime,
} from '@/components/ui';
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

/** Layer 2, mirrored in the UI. The authoritative checks are Hasura + Postgres + the engine. */
const OWNER_ONLY_STEPS: string[] = ['db_write', 'notify'];
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
  approval_gate: { approver_role: 'editor', message: 'Review the result before it is written and announced.' },
  db_write: { key: 'triage_result', payload: { summary: '{{prev.output.json.summary}}' } },
  notify: { channel: 'slack', message: 'Workflow finished: {{prev.output.json.summary}}' },
};

type Step = { id?: string; name: string; type: string; position: number; config: any };
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

  const { data, loading, error, refetch } = useQuery(WORKFLOW_DETAIL, { variables: { id: params.id } });
  const workflow = data?.workflows_by_pk;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [steps, setSteps] = useState<Step[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [picking, setPicking] = useState(false);
  const dragFrom = useRef<number | null>(null);

  useEffect(() => {
    if (!workflow) return;
    setName(workflow.name);
    setDescription(workflow.description);
    setIsActive(workflow.is_active);
    setSteps(
      workflow.steps.map((s: any) => ({ id: s.id, name: s.name, type: s.type, position: s.position, config: s.config })),
    );
    setDirty(false);
  }, [workflow]);

  const [save, { loading: saving, error: saveError }] = useMutation(SAVE_WORKFLOW);
  const [removeWorkflow] = useMutation(DELETE_WORKFLOW);

  if (loading && !data) {
    return (
      <div className="card pad stack-12">
        <Skeleton h={20} w={240} />
        <Skeleton h={12} w={160} />
        <div style={{ height: 10 }} />
        {[0, 1, 2].map((i) => (
          <Skeleton h={46} key={i} />
        ))}
      </div>
    );
  }
  if (error) return <ErrorText error={error} />;
  if (!workflow) {
    return (
      <div className="card pad" style={{ maxWidth: 520 }}>
        <span
          className="brand-mark"
          style={{ width: 34, height: 34, borderRadius: 11, background: 'var(--surface-3)', color: 'var(--text-subtle)' }}
        >
          <Lock size={16} />
        </span>
        <h1 style={{ marginTop: 14 }}>Not found</h1>
        <p className="muted small" style={{ marginTop: 6 }}>
          This workflow does not exist, or it belongs to an organization you are not a member of.
          Hasura returns the same empty result either way, so the id cannot be probed.
        </p>
        <Link className="btn" href="/" style={{ marginTop: 16 }}>
          Back to workflows
        </Link>
      </div>
    );
  }

  const mutateSteps = (next: Step[]) => {
    setSteps(next.map((s, i) => ({ ...s, position: i })));
    setDirty(true);
    setSaved(false);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= steps.length || from === to) return;
    const next = [...steps];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    mutateSteps(next);
  };

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
      <div className="page-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link className="breadcrumb" href="/">
            <ChevronLeft size={13} />
            Workflows
          </Link>
          {canEdit ? (
            <input
              className="inline-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
                setSaved(false);
              }}
              aria-label="Workflow name"
            />
          ) : (
            <h1>{workflow.name}</h1>
          )}
          <div className="row wrap" style={{ gap: 8, marginTop: 6 }}>
            <StatusBadge status={workflow.latest_run_status} />
            {!isActive && <span className="badge warn">inactive</span>}
            <span className="tiny subtle">
              {steps.length} step{steps.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>
        <div className="row">
          {canEdit && <RunButton workflowId={workflow.id} />}
        </div>
      </div>

      <div className="grid main-rail">
        <div className="stack-16">
          <section className="card">
            <div className="card-head">
              <h2 style={{ flex: 1 }}>Steps</h2>
              <span className="tiny subtle">runs top to bottom</span>
            </div>

            <div className="card-body">
              {steps.length === 0 && !picking && (
                <Empty
                  title="No steps yet"
                  action={
                    canEdit ? (
                      <button className="btn primary" onClick={() => setPicking(true)}>
                        <Plus size={14} />
                        Add the first step
                      </button>
                    ) : undefined
                  }
                >
                  Start with an LLM call, branch on what it returns, then gate the result on a human.
                </Empty>
              )}

              <div className="chain">
                {steps.map((step, index) => (
                  <StepCard
                    key={`${step.id ?? 'new'}-${index}`}
                    step={step}
                    index={index}
                    total={steps.length}
                    editable={canEdit}
                    isOwner={isOwner}
                    onChange={(next) => mutateSteps(steps.map((s, i) => (i === index ? next : s)))}
                    onMove={(delta) => move(index, index + delta)}
                    onDelete={() => mutateSteps(steps.filter((_, i) => i !== index))}
                    onDragStart={() => (dragFrom.current = index)}
                    onDrop={() => {
                      if (dragFrom.current !== null) move(dragFrom.current, index);
                      dragFrom.current = null;
                    }}
                  />
                ))}
              </div>

              {canEdit && (
                <div style={{ marginTop: steps.length ? 12 : 0 }}>
                  {picking ? (
                    <div
                      className="rise"
                      style={{
                        padding: 14,
                        border: '1px dashed var(--border-strong)',
                        borderRadius: 'var(--r-md)',
                        background: 'var(--surface-2)',
                      }}
                    >
                      <div className="row between" style={{ marginBottom: 11 }}>
                        <span className="label" style={{ margin: 0 }}>
                          Pick a step type
                        </span>
                        <button className="btn xs ghost" onClick={() => setPicking(false)}>
                          Cancel
                        </button>
                      </div>
                      <div className="picker">
                        {STEP_TYPES.map((type) => {
                          const meta = STEP_META[type];
                          const Icon = STEP_ICON[type];
                          const blocked = OWNER_ONLY_STEPS.includes(type) && !isOwner;
                          return (
                            <button
                              key={type}
                              disabled={blocked}
                              title={blocked ? 'Only an organization owner can add this step type' : undefined}
                              onClick={() => {
                                mutateSteps([
                                  ...steps,
                                  {
                                    name: meta.label,
                                    type,
                                    position: steps.length,
                                    config: structuredClone(DEFAULT_CONFIG[type]),
                                  },
                                ]);
                                setPicking(false);
                              }}
                            >
                              <span
                                style={{
                                  width: 26,
                                  height: 26,
                                  flex: 'none',
                                  borderRadius: 8,
                                  display: 'grid',
                                  placeItems: 'center',
                                  color: meta.color,
                                  background: `color-mix(in srgb, ${meta.color} 12%, transparent)`,
                                }}
                              >
                                {Icon && <Icon size={14} />}
                              </span>
                              <span style={{ minWidth: 0 }}>
                                <span className="t row" style={{ gap: 5 }}>
                                  {meta.label}
                                  {blocked && <Lock size={11} />}
                                </span>
                                <span className="d">{blocked ? 'Owner only' : meta.blurb}</span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    steps.length > 0 && (
                      <button className="btn" onClick={() => setPicking(true)}>
                        <Plus size={14} />
                        Add step
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          </section>

          {canEdit && (
            <section className="card">
              <div className="card-head">
                <h2 style={{ flex: 1 }}>Settings</h2>
              </div>
              <div className="card-body">
                <div className="field">
                  <label>Description</label>
                  <input
                    className="prose"
                    value={description}
                    onChange={(e) => {
                      setDescription(e.target.value);
                      setDirty(true);
                      setSaved(false);
                    }}
                    style={{ fontFamily: 'var(--font-sans)' }}
                  />
                </div>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => {
                      setIsActive(e.target.checked);
                      setDirty(true);
                      setSaved(false);
                    }}
                  />
                  Active — an inactive workflow refuses every trigger, including webhooks
                </label>
              </div>
            </section>
          )}

          {isOwner && (
            <section className="card">
              <div className="card-head">
                <h2 style={{ flex: 1 }}>Danger zone</h2>
              </div>
              <div className="card-body row between" style={{ gap: 12 }}>
                <span className="small muted">Deleting removes the workflow, its steps, triggers and run history.</span>
                <button
                  className="btn danger"
                  onClick={async () => {
                    await removeWorkflow({ variables: { id: workflow.id } });
                    router.push('/');
                  }}
                >
                  <Trash size={14} />
                  Delete workflow
                </button>
              </div>
            </section>
          )}
        </div>

        <div className="stack-16">
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

      {canEdit && (dirty || saved) && (
        <div
          className="rise"
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 22,
            transform: 'translateX(-50%)',
            zIndex: 45,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '9px 10px 9px 16px',
            borderRadius: 999,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          {saved && !dirty ? (
            <span className="row small" style={{ gap: 6, color: 'var(--ok)' }}>
              <Check size={14} />
              Saved
            </span>
          ) : (
            <>
              <span className="small muted nowrap">Unsaved changes</span>
              <button className="btn primary sm" onClick={onSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save workflow'}
              </button>
            </>
          )}
        </div>
      )}
      {saveError && (
        <div style={{ position: 'fixed', left: 20, right: 20, bottom: 74, maxWidth: 520, margin: '0 auto', zIndex: 45 }}>
          <ErrorText error={saveError} />
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------- step card */

function StepCard({
  step,
  index,
  total,
  editable,
  isOwner,
  onChange,
  onMove,
  onDelete,
  onDragStart,
  onDrop,
}: {
  step: Step;
  index: number;
  total: number;
  editable: boolean;
  isOwner: boolean;
  onChange: (next: Step) => void;
  onMove: (delta: number) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState(false);
  const [over, setOver] = useState(false);
  const locked = OWNER_ONLY_STEPS.includes(step.type) && !isOwner;
  const disabled = !editable || locked;
  const meta = STEP_META[step.type];

  return (
    <div
      className="chain-item"
      draggable={editable && !locked}
      onDragStart={onDragStart}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop();
      }}
    >
      <span
        className="chain-node"
        style={{
          color: meta?.color,
          borderColor: meta ? `color-mix(in srgb, ${meta.color} 34%, transparent)` : undefined,
          background: meta ? `color-mix(in srgb, ${meta.color} 10%, var(--surface))` : undefined,
        }}
      >
        <StepGlyph type={step.type} size={13} />
      </span>

      <div className="chain-body">
        <div className="step" style={over ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 3px var(--accent-soft)' } : undefined}>
          <div className="step-head">
            <input
              className="step-title"
              value={step.name}
              disabled={disabled}
              onChange={(e) => onChange({ ...step, name: e.target.value })}
              style={{
                flex: 1,
                border: '1px solid transparent',
                background: 'transparent',
                padding: '3px 6px',
                marginLeft: -6,
                borderRadius: 'var(--r-xs)',
              }}
            />
            <TypePill type={step.type} />
            {locked && (
              <span className="badge warn">
                <Lock size={10} />
                owner only
              </span>
            )}
            {editable && !locked && (
              <>
                <button className="btn icon xs ghost" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move up">
                  <ArrowUp size={13} />
                </button>
                <button className="btn icon xs ghost" onClick={() => onMove(1)} disabled={index === total - 1} aria-label="Move down">
                  <ArrowDown size={13} />
                </button>
                <button className="btn icon xs ghost" onClick={onDelete} aria-label="Delete step">
                  <Trash size={13} />
                </button>
              </>
            )}
            <button className="btn icon xs ghost" onClick={() => setOpen((v) => !v)} aria-label="Toggle config">
              <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .18s' }} />
            </button>
          </div>

          {open && (
            <div className="step-config">
              {raw ? (
                <JsonArea
                  label="Raw config"
                  value={step.config}
                  onChange={(v) => onChange({ ...step, config: v })}
                  seed={`${step.id ?? index}-raw`}
                  rows={10}
                  disabled={disabled}
                />
              ) : (
                <ConfigEditor
                  type={step.type}
                  config={step.config ?? {}}
                  onChange={(config) => onChange({ ...step, config })}
                  seed={`${step.id ?? index}`}
                  stepCount={total}
                  disabled={disabled}
                />
              )}
              <div className="row between" style={{ marginTop: 12 }}>
                <span className="tiny subtle">{meta?.blurb}</span>
                <button className="btn xs ghost" onClick={() => setRaw((v) => !v)}>
                  {raw ? 'Guided editor' : 'Raw JSON'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- triggers */

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
  const { data: secrets } = useQuery(WORKFLOW_WEBHOOKS, { variables: { id: workflowId }, skip: !isOwner });

  const secretFor = (id: string) =>
    secrets?.workflow_triggers?.find((t: any) => t.id === id)?.webhook_secret as string | undefined;

  const existing = new Set(triggers.map((t) => t.type));

  return (
    <section className="card">
      <div className="card-head">
        <h2 style={{ flex: 1 }}>Triggers</h2>
      </div>

      <div className="card-body stack-8">
        {triggers.length === 0 && <div className="small subtle">No triggers yet.</div>}
        {triggers.map((t) => {
          const Icon = TRIGGER_ICON[t.type];
          return (
            <div key={t.id} className="step" style={{ padding: '10px 11px' }}>
              <div className="row between">
                <span className="row" style={{ gap: 8 }}>
                  {Icon && <Icon size={14} className="subtle" />}
                  <span className="small strong">{TRIGGER_META[t.type]?.label ?? t.type}</span>
                  {t.cron && <span className="badge mono">{t.cron}</span>}
                  {!t.is_active && <span className="badge">off</span>}
                </span>
                {isOwner && (
                  <button
                    className="btn icon xs ghost"
                    aria-label="Remove trigger"
                    onClick={async () => {
                      await remove({ variables: { id: t.id } });
                      onChanged();
                    }}
                  >
                    <Trash size={13} />
                  </button>
                )}
              </div>
              <div className="tiny subtle" style={{ marginTop: 3 }}>
                {TRIGGER_META[t.type]?.blurb} · {t.last_fired_at ? `fired ${relTime(t.last_fired_at)}` : 'never fired'}
              </div>

              {t.type === 'webhook' &&
                (secretFor(t.id) ? (
                  <WebhookRecipe triggerId={t.id} secret={secretFor(t.id)!} />
                ) : (
                  <div className="tiny subtle" style={{ marginTop: 7 }}>
                    <Lock size={11} style={{ verticalAlign: -1 }} /> The webhook secret is a column-level
                    owner-only field.
                  </div>
                ))}
            </div>
          );
        })}

        {canEdit && (
          <div style={{ marginTop: 6 }}>
            <div className="label">Add a trigger</div>
            <div className="row wrap" style={{ gap: 6 }}>
              {(['manual', 'webhook', 'scheduled', 'database_event'] as const).map((type) => {
                const blocked = OWNER_ONLY_TRIGGERS.includes(type) && !isOwner;
                const Icon = TRIGGER_ICON[type];
                return (
                  <button
                    key={type}
                    className="btn sm"
                    disabled={blocked || loading || existing.has(type)}
                    title={
                      blocked
                        ? 'Only an owner can create an inbound webhook trigger'
                        : existing.has(type)
                          ? 'Already configured'
                          : TRIGGER_META[type].blurb
                    }
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
                    {Icon && <Icon size={13} />}
                    {TRIGGER_META[type].label}
                    {blocked && <Lock size={11} />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <ErrorText error={error} />
      </div>
    </section>
  );
}

function WebhookRecipe({ triggerId, secret }: { triggerId: string; secret: string }) {
  const [show, setShow] = useState(false);
  const body = JSON.stringify({
    query:
      'mutation($t:uuid!,$s:String!,$p:jsonb){triggerWorkflowWebhook(trigger_id:$t,secret:$s,payload:$p){run_id status}}',
    variables: { t: triggerId, s: secret, p: { message: 'Inbound from an external system' } },
  });
  const curl = `curl -X POST ${GRAPHQL_HTTP} \\\n  -H 'content-type: application/json' \\\n  -d '${body}'`;

  return (
    <div style={{ marginTop: 9 }}>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn xs" onClick={() => setShow((v) => !v)}>
          <Webhook size={12} />
          {show ? 'Hide' : 'Show'} inbound endpoint
        </button>
        <CopyButton value={curl} label="Copy curl" className="btn xs" />
      </div>
      {show && (
        <>
          <div className="tiny subtle" style={{ margin: '8px 0 6px' }}>
            Unauthenticated by design — the per-trigger secret is verified inside the handler with a
            constant-time comparison.
          </div>
          <pre className="scroll" style={{ maxHeight: 150 }}>
            {curl}
          </pre>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- run bits */

function RunButton({ workflowId }: { workflowId: string }) {
  const router = useRouter();
  const [trigger, { loading, error }] = useMutation(TRIGGER_WORKFLOW_RUN);
  return (
    <>
      <button
        className="btn primary"
        disabled={loading}
        onClick={async () => {
          const res = await trigger({
            variables: { workflowId, input: { message: 'The app keeps crashing and I am furious about it.' } },
          });
          const id = res.data?.triggerWorkflowRun?.run_id;
          if (id) router.push(`/runs/${id}`);
        }}
      >
        <Play size={13} />
        {loading ? 'Running…' : 'Run'}
      </button>
      {error && (
        <div style={{ position: 'fixed', right: 20, bottom: 20, maxWidth: 420, zIndex: 45 }}>
          <ErrorText error={error} />
        </div>
      )}
    </>
  );
}

function RunHistory({ workflowId }: { workflowId: string }) {
  const { data } = useQuery(WORKFLOW_RUNS, { variables: { workflowId }, pollInterval: 5000 });
  const runs = data?.workflow_runs ?? [];

  return (
    <section className="card">
      <div className="card-head">
        <h2 style={{ flex: 1 }}>Recent runs</h2>
        <Link className="tiny" href="/runs" style={{ color: 'var(--accent)' }}>
          all runs
        </Link>
      </div>
      {runs.length === 0 ? (
        <div className="card-body small subtle">No runs yet.</div>
      ) : (
        <div>
          {runs.slice(0, 8).map((run: any) => (
            <Link key={run.id} href={`/runs/${run.id}`} className="list-row" style={{ display: 'flex', padding: '10px 18px' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <TriggerPill type={run.trigger_type} muted />
                  <span className="tiny subtle">{relTime(run.created_at)}</span>
                </div>
                {run.initiator && (
                  <div className="tiny subtle truncate" style={{ marginTop: 2 }}>
                    {run.initiator.displayName || run.initiator.email}
                  </div>
                )}
              </div>
              <StatusBadge status={run.status} />
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
