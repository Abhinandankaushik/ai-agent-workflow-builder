import { adminGql } from '@/server/admin';
import { startRun } from '@/server/engine/run';
import {
  assertHasuraCaller,
  handlerResponse,
  requireMembership,
  HandlerError,
  type ActionPayload,
} from '@/server/guards';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Input = { workflow_id: string; input?: Record<string, unknown> | null };

export async function POST(req: Request) {
  try {
    assertHasuraCaller(req);
    const payload = (await req.json()) as ActionPayload<Input>;
    const userId = payload.session_variables?.['x-hasura-user-id'];
    const { workflow_id, input } = payload.input;

    const data = await adminGql<{
      workflows_by_pk: { id: string; org_id: string; is_active: boolean } | null;
    }>(
      `query ($id: uuid!) { workflows_by_pk(id: $id) { id org_id is_active } }`,
      { id: workflow_id },
    );

    const workflow = data.workflows_by_pk;
    // Same message whether the workflow is missing or belongs to another org,
    // so a caller can never use this endpoint to probe for valid ids.
    if (!workflow) throw new HandlerError('You do not have access to this workflow.', 'forbidden');

    await requireMembership(userId, workflow.org_id, ['owner', 'editor']);

    if (!workflow.is_active) {
      throw new HandlerError('This workflow is paused and cannot be run.', 'workflow_inactive');
    }

    const { runId, status } = await startRun({
      workflowId: workflow.id,
      orgId: workflow.org_id,
      triggeredBy: userId ?? null,
      triggerType: 'manual',
      input: input ?? {},
    });

    return Response.json({
      run_id: runId,
      status,
      message:
        status === 'paused'
          ? 'Run paused at an approval gate.'
          : `Run ${status}.`,
    });
  } catch (err) {
    return handlerResponse(err);
  }
}
