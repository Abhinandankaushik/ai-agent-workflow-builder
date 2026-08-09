import { adminGql } from '@/server/admin';
import { startRun } from '@/server/engine/run';
import { assertHasuraCaller } from '@/server/guards';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Minimal 5-field cron matcher: wildcards, steps, ranges and lists.
function fieldMatches(field: string, value: number): boolean {
  return field.split(',').some((part) => {
    const [range, stepRaw] = part.split('/');
    const step = stepRaw ? Number(stepRaw) : 1;
    if (range === '*') return value % step === 0;
    const [fromRaw, toRaw] = range.split('-');
    const from = Number(fromRaw);
    const to = toRaw === undefined ? from : Number(toRaw);
    if (Number.isNaN(from) || Number.isNaN(to)) return false;
    return value >= from && value <= to && (value - from) % step === 0;
  });
}

function cronIsDue(expression: string, at: Date): boolean {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const [minute, hour, dom, month, dow] = fields;
  return (
    fieldMatches(minute, at.getUTCMinutes()) &&
    fieldMatches(hour, at.getUTCHours()) &&
    fieldMatches(dom, at.getUTCDate()) &&
    fieldMatches(month, at.getUTCMonth() + 1) &&
    fieldMatches(dow, at.getUTCDay())
  );
}

/**
 * Hasura's cron trigger calls this every minute; the handler decides which
 * scheduled workflow triggers are actually due. Keeping the schedule in the
 * database (rather than one Hasura cron per workflow) means users can add
 * scheduled triggers without touching Hasura metadata.
 */
export async function POST(req: Request) {
  try {
    assertHasuraCaller(req);
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return run();
}

// convenient for manual verification during a demo
export async function GET(req: Request) {
  try {
    assertHasuraCaller(req);
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return run();
}

async function run() {
  const now = new Date();
  const minuteStart = new Date(now);
  minuteStart.setUTCSeconds(0, 0);

  const data = await adminGql<{
    workflow_triggers: Array<{
      id: string;
      cron: string | null;
      config: Record<string, any>;
      last_fired_at: string | null;
      workflow: { id: string; org_id: string; is_active: boolean };
    }>;
  }>(
    `query {
       workflow_triggers(where: {
         type: {_eq: "scheduled"},
         is_active: {_eq: true},
         workflow: {is_active: {_eq: true}}
       }) {
         id cron config last_fired_at
         workflow { id org_id is_active }
       }
     }`,
  );

  const fired: Array<Record<string, unknown>> = [];

  for (const trigger of data.workflow_triggers) {
    if (!trigger.cron || !cronIsDue(trigger.cron, now)) continue;
    // guard against a duplicate cron delivery re-running the same minute
    if (trigger.last_fired_at && new Date(trigger.last_fired_at) >= minuteStart) continue;

    try {
      const { runId, status } = await startRun({
        workflowId: trigger.workflow.id,
        orgId: trigger.workflow.org_id,
        triggerType: 'scheduled',
        triggerId: trigger.id,
        triggeredBy: null,
        input: trigger.config?.input ?? trigger.config ?? {},
      });
      fired.push({ trigger_id: trigger.id, run_id: runId, status });
    } catch (err) {
      fired.push({ trigger_id: trigger.id, error: err instanceof Error ? err.message : String(err) });
    }

    await adminGql(
      `mutation ($id: uuid!) {
         update_workflow_triggers_by_pk(pk_columns: {id: $id}, _set: {last_fired_at: "now()"}) { id }
       }`,
      { id: trigger.id },
    );
  }

  return Response.json({ ok: true, checked: data.workflow_triggers.length, fired });
}
