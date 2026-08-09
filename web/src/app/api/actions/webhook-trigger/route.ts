import { timingSafeEqual } from 'node:crypto';
import { adminGql } from '@/server/admin';
import { startRun } from '@/server/engine/run';
import { assertHasuraCaller, handlerResponse, HandlerError, type ActionPayload } from '@/server/guards';

export const runtime = 'nodejs';
export const maxDuration = 60;

type Input = { trigger_id: string; secret: string; payload?: Record<string, unknown> | null };

function secretsMatch(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function POST(req: Request) {
  try {
    assertHasuraCaller(req);
    const payload = (await req.json()) as ActionPayload<Input>;
    const { trigger_id, secret, payload: body } = payload.input;

    const data = await adminGql<{
      workflow_triggers_by_pk: {
        id: string;
        type: string;
        is_active: boolean;
        webhook_secret: string;
        workflow: { id: string; org_id: string; is_active: boolean };
      } | null;
    }>(
      `query ($id: uuid!) {
         workflow_triggers_by_pk(id: $id) {
           id type is_active webhook_secret
           workflow { id org_id is_active }
         }
       }`,
      { id: trigger_id },
    );

    const trigger = data.workflow_triggers_by_pk;
    // This endpoint is unauthenticated by design, so every failure mode returns
    // the same message: nothing here can be used to enumerate triggers.
    const invalid = new HandlerError('Invalid webhook trigger or secret.', 'invalid_webhook');
    if (!trigger || trigger.type !== 'webhook' || !trigger.is_active) throw invalid;
    if (!secret || !secretsMatch(secret, trigger.webhook_secret)) throw invalid;
    if (!trigger.workflow.is_active) throw invalid;

    const { runId, status } = await startRun({
      workflowId: trigger.workflow.id,
      orgId: trigger.workflow.org_id,
      triggerType: 'webhook',
      triggerId: trigger.id,
      triggeredBy: null,
      input: body ?? {},
    });

    await adminGql(
      `mutation ($id: uuid!) {
         update_workflow_triggers_by_pk(pk_columns: {id: $id}, _set: {last_fired_at: "now()"}) { id }
       }`,
      { id: trigger.id },
    );

    return Response.json({ run_id: runId, status, message: `Run ${status} via webhook.` });
  } catch (err) {
    return handlerResponse(err);
  }
}
