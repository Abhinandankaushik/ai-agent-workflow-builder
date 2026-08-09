import { adminGql } from '@/server/admin';
import { serverEnv } from '@/server/env';
import { assertHasuraCaller } from '@/server/guards';

export const runtime = 'nodejs';
export const maxDuration = 30;

type NotificationRow = {
  id: string;
  channel: string;
  target: string | null;
  message: string;
  status: string;
  workflow_run_id: string | null;
};

/**
 * The `notify` step type, implemented as a Hasura Event Trigger: the engine only
 * inserts a notifications row and Hasura delivers it here asynchronously (with
 * its own retry policy), so a slow or broken Slack never stalls a run.
 */
export async function POST(req: Request) {
  try {
    assertHasuraCaller(req);
  } catch {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const row: NotificationRow | undefined = body?.event?.data?.new;
  if (!row?.id) return Response.json({ ok: true, skipped: 'no row' });
  if (row.status !== 'pending') return Response.json({ ok: true, skipped: 'already handled' });

  const webhookUrl =
    row.target && row.target.startsWith('https://hooks.slack.com/')
      ? row.target
      : serverEnv.slackWebhookUrl;

  let status = 'sent';
  let error: string | null = null;

  if (row.channel === 'slack' && webhookUrl) {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `:robot_face: ${row.message}` }),
      });
      if (!res.ok) {
        status = 'failed';
        error = `Slack responded ${res.status}: ${(await res.text()).slice(0, 200)}`;
      }
    } catch (err) {
      status = 'failed';
      error = err instanceof Error ? err.message : String(err);
    }
  } else {
    // No Slack webhook configured: the row itself is the delivery record, which
    // keeps the demo working without an external integration.
    error = webhookUrl ? null : 'No SLACK_WEBHOOK_URL configured; logged only.';
    console.log('[notify]', row.channel, row.message);
  }

  await adminGql(
    `mutation ($id: uuid!, $set: notifications_set_input!) {
       update_notifications_by_pk(pk_columns: {id: $id}, _set: $set) { id }
     }`,
    { id: row.id, set: { status, error, delivered_at: 'now()' } },
  );

  // Always 200 for a permanent outcome so Hasura does not keep retrying.
  return Response.json({ ok: true, status, error });
}
