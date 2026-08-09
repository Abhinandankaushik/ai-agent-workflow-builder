import { adminGql } from '@/server/admin';
import { advanceRun } from '@/server/engine/run';
import {
  assertHasuraCaller,
  handlerResponse,
  requireMembership,
  HandlerError,
  type ActionPayload,
} from '@/server/guards';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Input = { step_run_id: string; decision?: string | null; note?: string | null };

type StepRun = {
  id: string;
  org_id: string;
  status: string;
  type: string;
  position: number;
  workflow_run_id: string;
  step: { config: Record<string, any> } | null;
};

export async function POST(req: Request) {
  try {
    assertHasuraCaller(req);
    const payload = (await req.json()) as ActionPayload<Input>;
    const userId = payload.session_variables?.['x-hasura-user-id'];
    const { step_run_id, decision, note } = payload.input;

    const data = await adminGql<{ step_runs_by_pk: StepRun | null }>(
      `query ($id: uuid!) {
         step_runs_by_pk(id: $id) {
           id org_id status type position workflow_run_id
           step { config }
         }
       }`,
      { id: step_run_id },
    );

    const stepRun = data.step_runs_by_pk;
    if (!stepRun) throw new HandlerError('You do not have access to this step.', 'forbidden');

    // Layer 1: caller must belong to *this* org, whatever role their JWT claims.
    const membership = await requireMembership(userId, stepRun.org_id, ['owner', 'editor']);

    // Layer 2: an approval gate is a mid-execution decision, so the required
    // role lives in the step's config and can only be checked here — no row
    // permission can express "may resume a paused run".
    const requiredRole = String(stepRun.step?.config?.approver_role ?? 'owner');
    if (requiredRole === 'owner' && membership.role !== 'owner') {
      throw new HandlerError('Only an organization owner can clear this approval gate.', 'approval_forbidden');
    }

    if (stepRun.type !== 'approval_gate') {
      throw new HandlerError('That step is not an approval gate.', 'invalid_step');
    }
    if (stepRun.status !== 'awaiting_approval') {
      throw new HandlerError(`This step is not awaiting approval (status: ${stepRun.status}).`, 'invalid_state');
    }

    const rejected = String(decision ?? 'approve').toLowerCase() === 'reject';

    await adminGql(
      `mutation ($id: uuid!, $set: step_runs_set_input!) {
         update_step_runs_by_pk(pk_columns: {id: $id}, _set: $set) { id }
       }`,
      {
        id: stepRun.id,
        set: {
          status: rejected ? 'rejected' : 'succeeded',
          approved_by: userId,
          approved_at: 'now()',
          approval_note: note ?? null,
          finished_at: 'now()',
          output: { approved: !rejected, approved_by: userId, note: note ?? null, role: membership.role },
        },
      },
    );

    if (rejected) {
      await adminGql(
        `mutation ($id: uuid!) {
           update_workflow_runs_by_pk(
             pk_columns: {id: $id},
             _set: {status: "cancelled", error: "Approval rejected", finished_at: "now()"}
           ) { id }
           update_step_runs(
             where: {workflow_run_id: {_eq: $id}, status: {_eq: "pending"}},
             _set: {status: "skipped", finished_at: "now()"}
           ) { affected_rows }
         }`,
        { id: stepRun.workflow_run_id },
      );
      return Response.json({
        step_run_id: stepRun.id,
        run_status: 'cancelled',
        approved: false,
        message: 'Approval rejected; the run was cancelled.',
      });
    }

    await adminGql(
      `mutation ($id: uuid!, $cursor: Int!) {
         update_workflow_runs_by_pk(pk_columns: {id: $id}, _set: {cursor: $cursor, status: "running"}) { id }
       }`,
      { id: stepRun.workflow_run_id, cursor: stepRun.position + 1 },
    );

    const runStatus = await advanceRun(stepRun.workflow_run_id);

    return Response.json({
      step_run_id: stepRun.id,
      run_status: runStatus,
      approved: true,
      message: `Approved by ${membership.role}; run is now ${runStatus}.`,
    });
  } catch (err) {
    return handlerResponse(err);
  }
}
