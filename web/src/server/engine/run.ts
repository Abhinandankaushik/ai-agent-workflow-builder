import 'server-only';
import { adminGql, adminSql } from '../admin';
import { HandlerError } from '../guards';
import { executeStep, MAX_ATTEMPTS, RETRYABLE, type StepControl, type StepType } from './steps';
import type { RunContext } from './template';

const PRIVILEGED_STEP_TYPES: StepType[] = ['db_write', 'notify'];

type StepRunRow = {
  id: string;
  position: number;
  name: string;
  type: StepType;
  status: string;
  output: unknown;
  attempt_count: number;
  step: { id: string; config: Record<string, any>; created_by: string | null } | null;
};

type RunRow = {
  id: string;
  org_id: string;
  workflow_id: string;
  status: string;
  cursor: number;
  input: unknown;
  step_runs: StepRunRow[];
};

const RUN_QUERY = `
  query ($id: uuid!) {
    workflow_runs_by_pk(id: $id) {
      id org_id workflow_id status cursor input
      step_runs(order_by: {position: asc}) {
        id position name type status output attempt_count
        step { id config created_by }
      }
    }
  }`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- quota

export async function assertQuotaAvailable(orgId: string) {
  await adminSql(`SELECT public.roll_quota_period($1)`, [orgId]);
  const data = await adminGql<{ organizations_by_pk: { quota_used: number; quota_limit: number } | null }>(
    `query ($id: uuid!) { organizations_by_pk(id: $id) { quota_used quota_limit } }`,
    { id: orgId },
  );
  const org = data.organizations_by_pk;
  if (!org) throw new HandlerError('Organization not found.', 'not_found');
  if (org.quota_used >= org.quota_limit) {
    throw new HandlerError(
      `Quota exhausted for this period (${org.quota_used}/${org.quota_limit} runs used).`,
      'quota_exceeded',
    );
  }
}

async function consumeQuota(orgId: string) {
  // atomic check-and-increment, so parallel completions cannot overshoot
  await adminSql(`SELECT * FROM public.consume_org_quota($1, 1)`, [orgId]);
}

// ------------------------------------------------------- step / run writes

async function patchStepRun(id: string, set: Record<string, unknown>) {
  await adminGql(
    `mutation ($id: uuid!, $set: step_runs_set_input!) {
       update_step_runs_by_pk(pk_columns: {id: $id}, _set: $set) { id }
     }`,
    { id, set },
  );
}

async function patchRun(id: string, set: Record<string, unknown>) {
  await adminGql(
    `mutation ($id: uuid!, $set: workflow_runs_set_input!) {
       update_workflow_runs_by_pk(pk_columns: {id: $id}, _set: $set) { id }
     }`,
    { id, set },
  );
}

async function skipRange(runId: string, from: number, to: number) {
  if (to < from) return;
  await adminGql(
    `mutation ($runId: uuid!, $from: Int!, $to: Int!) {
       update_step_runs(
         where: {workflow_run_id: {_eq: $runId}, position: {_gte: $from, _lte: $to}, status: {_eq: "pending"}},
         _set: {status: "skipped", finished_at: "now()"}
       ) { affected_rows }
     }`,
    { runId, from, to },
  );
}

// ------------------------------------------------------------ layer 2 gate

/**
 * Layer 2, enforced at execution time.
 *
 * Row permissions stop an editor from *creating* a db_write or notify step, but
 * a step authored while someone was an owner must not keep running privileged
 * work after they are demoted. The engine therefore re-verifies the author is
 * still an owner of the run's org immediately before every privileged step.
 */
async function assertPrivilegedStepAllowed(orgId: string, step: StepRunRow) {
  if (!PRIVILEGED_STEP_TYPES.includes(step.type)) return;
  const author = step.step?.created_by;
  if (!author) {
    throw new HandlerError(`Step "${step.name}" (${step.type}) has no known author.`, 'step_forbidden');
  }
  const data = await adminGql<{ org_members: Array<{ role: string }> }>(
    `query ($orgId: uuid!, $userId: uuid!) {
       org_members(where: {org_id: {_eq: $orgId}, user_id: {_eq: $userId}, role: {_eq: "owner"}}) { role }
     }`,
    { orgId, userId: author },
  );
  if (!data.org_members.length) {
    throw new HandlerError(
      `Step "${step.name}" is a ${step.type} step and its author is no longer an owner of this organization.`,
      'step_forbidden',
    );
  }
}

// ---------------------------------------------------------------- start

export type StartRunOptions = {
  workflowId: string;
  orgId: string;
  triggeredBy?: string | null;
  triggerType: 'manual' | 'webhook' | 'scheduled' | 'database_event';
  triggerId?: string | null;
  input?: unknown;
};

export async function startRun(opts: StartRunOptions): Promise<{ runId: string; status: string }> {
  await assertQuotaAvailable(opts.orgId);

  const data = await adminGql<{
    workflow_steps: Array<{ id: string; name: string; type: StepType; position: number }>;
  }>(
    `query ($workflowId: uuid!) {
       workflow_steps(where: {workflow_id: {_eq: $workflowId}}, order_by: {position: asc}) {
         id name type position
       }
     }`,
    { workflowId: opts.workflowId },
  );

  if (!data.workflow_steps.length) {
    throw new HandlerError('This workflow has no steps yet.', 'empty_workflow');
  }

  const created = await adminGql<{ insert_workflow_runs_one: { id: string } }>(
    `mutation ($obj: workflow_runs_insert_input!) {
       insert_workflow_runs_one(object: $obj) { id }
     }`,
    {
      obj: {
        workflow_id: opts.workflowId,
        org_id: opts.orgId,
        triggered_by: opts.triggeredBy ?? null,
        trigger_type: opts.triggerType,
        trigger_id: opts.triggerId ?? null,
        input: opts.input ?? {},
        status: 'running',
        started_at: 'now()',
        // step_runs are created up front so the subscription shows the whole
        // plan (pending -> running -> succeeded) instead of rows appearing late
        step_runs: {
          data: data.workflow_steps.map((s, index) => ({
            step_id: s.id,
            org_id: opts.orgId,
            name: s.name,
            type: s.type,
            position: index,
          })),
        },
      },
    },
  );

  const runId = created.insert_workflow_runs_one.id;
  const status = await advanceRun(runId);
  return { runId, status };
}

// ---------------------------------------------------------------- advance

export async function advanceRun(runId: string): Promise<string> {
  const data = await adminGql<{ workflow_runs_by_pk: RunRow | null }>(RUN_QUERY, { id: runId });
  const run = data.workflow_runs_by_pk;
  if (!run) throw new HandlerError('Run not found.', 'not_found');
  if (!['running', 'paused', 'pending'].includes(run.status)) return run.status;

  const stepRuns = run.step_runs;
  const ctx: RunContext = { run: { id: run.id, input: run.input }, steps: {}, prev: null };
  for (const sr of stepRuns) {
    if (sr.status === 'succeeded') {
      ctx.steps[sr.name] = { output: sr.output };
      ctx.prev = { output: sr.output };
    }
  }

  if (run.status !== 'running') await patchRun(run.id, { status: 'running' });

  let index = Math.max(0, run.cursor ?? 0);

  while (index < stepRuns.length) {
    const sr = stepRuns[index];

    if (sr.status === 'skipped' || sr.status === 'succeeded') {
      index += 1;
      continue;
    }

    // ------------------------------------------------ approval gate: pause
    if (sr.type === 'approval_gate') {
      await patchStepRun(sr.id, {
        status: 'awaiting_approval',
        started_at: 'now()',
        input: sr.step?.config ?? {},
      });
      await patchRun(run.id, { status: 'paused', cursor: index });
      return 'paused';
    }

    await patchRun(run.id, { cursor: index });
    await patchStepRun(sr.id, { status: 'running', started_at: 'now()', error: null });

    let attempt = 0;
    let control: StepControl | undefined;
    let failure: unknown = null;

    while (attempt < MAX_ATTEMPTS) {
      attempt += 1;
      try {
        await assertPrivilegedStepAllowed(run.org_id, sr);
        const result = await executeStep({
          type: sr.type,
          name: sr.name,
          config: sr.step?.config ?? {},
          orgId: run.org_id,
          runId: run.id,
          stepRunId: sr.id,
          ctx,
        });
        await patchStepRun(sr.id, {
          status: 'succeeded',
          output: result.output as object,
          attempt_count: attempt,
          finished_at: 'now()',
          error: null,
        });
        ctx.steps[sr.name] = { output: result.output };
        ctx.prev = { output: result.output };
        control = result.control;
        failure = null;
        break;
      } catch (err) {
        failure = err;
        const message = err instanceof Error ? err.message : String(err);
        const retryable = RETRYABLE.includes(sr.type) && !(err instanceof HandlerError);
        await patchStepRun(sr.id, {
          attempt_count: attempt,
          error: retryable && attempt < MAX_ATTEMPTS ? `attempt ${attempt} failed: ${message}` : message,
        });
        if (!retryable || attempt >= MAX_ATTEMPTS) break;
        await sleep(600 * attempt);
      }
    }

    if (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      await patchStepRun(sr.id, { status: 'failed', finished_at: 'now()', error: message });
      await skipRange(run.id, index + 1, stepRuns.length - 1);
      await patchRun(run.id, { status: 'failed', error: message, finished_at: 'now()', cursor: index });
      return 'failed';
    }

    if (control?.action === 'stop') {
      await skipRange(run.id, index + 1, stepRuns.length - 1);
      break;
    }

    if (control?.action === 'skip_to') {
      const target = Math.min(Math.max(control.position, index + 1), stepRuns.length);
      await skipRange(run.id, index + 1, target - 1);
      index = target;
      continue;
    }

    index += 1;
  }

  await consumeQuota(run.org_id);
  await patchRun(run.id, {
    status: 'completed',
    finished_at: 'now()',
    cursor: stepRuns.length,
    output: (ctx.prev?.output ?? null) as object,
  });
  return 'completed';
}
