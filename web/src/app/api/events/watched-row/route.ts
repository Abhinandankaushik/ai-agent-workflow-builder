import { adminGql } from '@/server/admin';
import { startRun } from '@/server/engine/run';
import { assertHasuraCaller } from '@/server/guards';

export const runtime = 'nodejs';
export const maxDuration = 60;

type WatchedEventRow = {
  id: string;
  org_id: string;
  source: string;
  payload: Record<string, unknown>;
};

/**
 * Database-event trigger: a row landing in watched_events starts every workflow
 * in that org whose database_event trigger listens to the same source. No user
 * click, no JWT — the org scope comes from the row itself.
 */
export async function POST(req: Request) {
  try {
    assertHasuraCaller(req);
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const row: WatchedEventRow | undefined = body?.event?.data?.new;
  if (!row?.id) return Response.json({ ok: true, skipped: 'no row' });

  const data = await adminGql<{
    workflow_triggers: Array<{
      id: string;
      config: Record<string, any>;
      workflow: { id: string; org_id: string; is_active: boolean };
    }>;
  }>(
    `query ($orgId: uuid!) {
       workflow_triggers(where: {
         type: {_eq: "database_event"},
         is_active: {_eq: true},
         workflow: {org_id: {_eq: $orgId}, is_active: {_eq: true}}
       }) {
         id config
         workflow { id org_id is_active }
       }
     }`,
    { orgId: row.org_id },
  );

  const started: Array<Record<string, unknown>> = [];

  for (const trigger of data.workflow_triggers) {
    const wanted = trigger.config?.source;
    if (wanted && wanted !== row.source) continue;
    try {
      const { runId, status } = await startRun({
        workflowId: trigger.workflow.id,
        orgId: trigger.workflow.org_id,
        triggerType: 'database_event',
        triggerId: trigger.id,
        triggeredBy: null,
        input: { ...row.payload, _event_id: row.id, _source: row.source },
      });
      started.push({ trigger_id: trigger.id, run_id: runId, status });
    } catch (err) {
      // A quota rejection is a permanent outcome, not a transient failure, so
      // it is recorded rather than bubbled up into Hasura's retry loop.
      started.push({
        trigger_id: trigger.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await adminGql(
    `mutation ($id: uuid!) {
       update_workflow_triggers(
         where: {type: {_eq: "database_event"}, workflow: {org_id: {_eq: $id}}},
         _set: {last_fired_at: "now()"}
       ) { affected_rows }
     }`,
    { id: row.org_id },
  );

  return Response.json({ ok: true, started });
}
