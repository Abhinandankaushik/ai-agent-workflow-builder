// Walks the Final Task scenario end to end through the public GraphQL API as
// the real seeded users — no admin secret, no simulated Action payloads.
//
//   node scripts/e2e.mjs

import { loadEnv, adminGraphql } from './lib.mjs';

const env = loadEnv();
const PASSWORD = process.env.SEED_PASSWORD || 'Password123!';

let failed = 0;
const ok = (name, pass, detail = '') => {
  if (!pass) failed += 1;
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${pass || !detail ? '' : ` — ${detail}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signIn(email) {
  const res = await fetch(`${env.authUrl}/signin/email-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const json = await res.json();
  if (!json.session) throw new Error(`sign-in failed for ${email}`);
  return json.session.accessToken;
}

async function gql(token, role, query, variables = {}) {
  const res = await fetch(env.graphqlUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(role ? { 'x-hasura-role': role } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

const err = (r) => (r.errors ?? []).map((e) => e.message).join('; ');

async function waitForRun(token, role, runId, predicate, timeoutMs = 90_000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const r = await gql(
      token,
      role,
      `query ($id: uuid!) {
         workflow_runs_by_pk(id: $id) {
           status error
           step_runs(order_by: {position: asc}) { position name type status attempt_count error }
         }
       }`,
      { id: runId },
    );
    last = r.data?.workflow_runs_by_pk;
    if (last && predicate(last)) return last;
    await sleep(1500);
  }
  return last;
}

const printSteps = (run) => {
  for (const s of run.step_runs) {
    console.log(
      `      ${s.position} ${s.name.padEnd(26)} ${s.type.padEnd(19)} ${s.status.padEnd(18)} a${s.attempt_count}` +
        (s.error ? `  ${s.error.slice(0, 70)}` : ''),
    );
  }
};

(async () => {
  const seed = await adminGraphql(
    env,
    `query {
       organizations(where: {slug: {_eq: "acme-ai"}}) {
         id
         workflows { id name }
         triggers: workflows { triggers { id type webhook_secret } }
       }
     }`,
  );
  const orgA = seed.organizations[0];
  const workflow = orgA.workflows[0];
  const webhookTrigger = orgA.triggers[0].triggers.find((t) => t.type === 'webhook');

  const ownerA = await signIn('owner.a@demo.dev');
  const editorA = await signIn('editor.a@demo.dev');
  const viewerA = await signIn('viewer.a@demo.dev');
  const ownerB = await signIn('owner.b@demo.dev');

  console.log('\n[1] Org A owner starts a run manually');
  const started = await gql(
    ownerA,
    'owner',
    `mutation ($id: uuid!, $input: jsonb) {
       triggerWorkflowRun(workflow_id: $id, input: $input) { run_id status message }
     }`,
    { id: workflow.id, input: { message: 'Your app crashed twice today and I lost my work. Fix it.' } },
  );
  const run = started.data?.triggerWorkflowRun;
  ok('run started through the Hasura Action', Boolean(run?.run_id), err(started));
  if (!run?.run_id) process.exit(1);
  console.log(`      run_id=${run.run_id} status=${run.status}`);

  const paused = await waitForRun(ownerA, 'owner', run.run_id, (r) => r.status === 'paused');
  printSteps(paused);
  ok('run pauses at the approval gate', paused.status === 'paused', `status=${paused.status}`);
  ok(
    'llm_call, conditional_branch and http_request all succeeded first',
    paused.step_runs.slice(0, 3).every((s) => s.status === 'succeeded'),
  );

  console.log('\n[2] Org B owner tries to see and touch the Org A run by id');
  const bSeesRun = await gql(
    ownerB,
    'owner',
    `query ($id: uuid!) { workflow_runs_by_pk(id: $id) { id status } }`,
    { id: run.run_id },
  );
  ok('Org B owner cannot read the run', bSeesRun.data?.workflow_runs_by_pk === null, JSON.stringify(bSeesRun.data));

  const bSeesSteps = await gql(
    ownerB,
    'owner',
    `query ($id: uuid!) { step_runs(where: {workflow_run_id: {_eq: $id}}) { id status } }`,
    { id: run.run_id },
  );
  ok('Org B owner cannot read its step_runs', bSeesSteps.data?.step_runs?.length === 0);

  const gateRow = await adminGraphql(
    env,
    `query ($id: uuid!) {
       step_runs(where: {workflow_run_id: {_eq: $id}, type: {_eq: "approval_gate"}}) { id }
     }`,
    { id: run.run_id },
  );
  const gateId = gateRow.step_runs[0].id;

  const bApprove = await gql(
    ownerB,
    'owner',
    `mutation ($id: uuid!) { approveStep(step_run_id: $id) { approved run_status } }`,
    { id: gateId },
  );
  ok('Org B owner cannot approve the Org A gate', Boolean(bApprove.errors), JSON.stringify(bApprove.data));

  const bTrigger = await gql(
    ownerB,
    'owner',
    `mutation ($id: uuid!) { triggerWorkflowRun(workflow_id: $id) { run_id } }`,
    { id: workflow.id },
  );
  ok('Org B owner cannot trigger the Org A workflow', Boolean(bTrigger.errors), JSON.stringify(bTrigger.data));

  console.log('\n[3] Org A viewer is blocked too');
  const vTrigger = await gql(
    viewerA,
    'viewer',
    `mutation ($id: uuid!) { triggerWorkflowRun(workflow_id: $id) { run_id } }`,
    { id: workflow.id },
  );
  ok('viewer cannot trigger a run', Boolean(vTrigger.errors));

  const vApprove = await gql(
    viewerA,
    'viewer',
    `mutation ($id: uuid!) { approveStep(step_run_id: $id) { approved } }`,
    { id: gateId },
  );
  ok('viewer cannot approve', Boolean(vApprove.errors));

  console.log('\n[4] Org A editor approves and the run resumes');
  const approved = await gql(
    editorA,
    'editor',
    `mutation ($id: uuid!, $note: String) {
       approveStep(step_run_id: $id, decision: "approve", note: $note) { approved run_status message }
     }`,
    { id: gateId, note: 'Verified by the on-call editor' },
  );
  ok('editor approval resumes the run', approved.data?.approveStep?.approved === true, err(approved));

  const done = await waitForRun(ownerA, 'owner', run.run_id, (r) => r.status === 'completed' || r.status === 'failed');
  printSteps(done);
  ok('run completes after approval', done.status === 'completed', `status=${done.status} ${done.error ?? ''}`);

  console.log('\n[5] Side effects landed');
  const effects = await gql(
    ownerA,
    'owner',
    `query ($id: uuid!) {
       workflow_artifacts(where: {workflow_run_id: {_eq: $id}}) { key payload }
       notifications(where: {workflow_run_id: {_eq: $id}}) { channel status error message }
     }`,
    { id: run.run_id },
  );
  ok('db_write produced an artifact', (effects.data?.workflow_artifacts?.length ?? 0) > 0);
  console.log(`      artifact: ${JSON.stringify(effects.data?.workflow_artifacts?.[0]?.payload).slice(0, 150)}`);

  // the notify event trigger is asynchronous; give Hasura a moment to deliver
  let notification = effects.data?.notifications?.[0];
  for (let i = 0; i < 8 && notification?.status === 'pending'; i += 1) {
    await sleep(2000);
    const again = await gql(
      ownerA,
      'owner',
      `query ($id: uuid!) { notifications(where: {workflow_run_id: {_eq: $id}}) { channel status error message } }`,
      { id: run.run_id },
    );
    notification = again.data?.notifications?.[0];
  }
  ok(
    'notify event trigger delivered to Slack',
    notification?.status === 'sent',
    `status=${notification?.status} ${notification?.error ?? ''}`,
  );

  console.log('\n[6] Webhook trigger — unauthenticated, from "an external system"');
  const webhookRun = await gql(
    null,
    null,
    `mutation ($t: uuid!, $s: String!, $p: jsonb) {
       triggerWorkflowWebhook(trigger_id: $t, secret: $s, payload: $p) { run_id status }
     }`,
    {
      t: webhookTrigger.id,
      s: webhookTrigger.webhook_secret,
      p: { message: 'Loving the new release, everything works great!' },
    },
  );
  ok(
    'webhook starts a run with no JWT at all',
    Boolean(webhookRun.data?.triggerWorkflowWebhook?.run_id),
    err(webhookRun),
  );

  if (webhookRun.data?.triggerWorkflowWebhook?.run_id) {
    const wr = await waitForRun(
      ownerA,
      'owner',
      webhookRun.data.triggerWorkflowWebhook.run_id,
      (r) => r.status === 'paused' || r.status === 'completed' || r.status === 'failed',
    );
    printSteps(wr);
    const branch = wr.step_runs[1];
    const http = wr.step_runs[2];
    ok(
      'positive sentiment takes the other branch and skips the http_request',
      branch.status === 'succeeded' && http.status === 'skipped',
      `branch=${branch.status} http=${http.status}`,
    );
  }

  const badSecret = await gql(
    null,
    null,
    `mutation ($t: uuid!, $s: String!) { triggerWorkflowWebhook(trigger_id: $t, secret: $s) { run_id } }`,
    { t: webhookTrigger.id, s: 'wrong-secret' },
  );
  ok('webhook rejects a wrong secret', Boolean(badSecret.errors));

  console.log('\n[7] Database event trigger — a row change starts a run');
  const before = await gql(
    ownerA,
    'owner',
    `query ($id: uuid!) { workflow_runs_aggregate(where: {workflow_id: {_eq: $id}, trigger_type: {_eq: "database_event"}}) { aggregate { count } } }`,
    { id: workflow.id },
  );
  const beforeCount = before.data?.workflow_runs_aggregate?.aggregate?.count ?? 0;

  const inserted = await gql(
    ownerA,
    'owner',
    `mutation ($orgId: uuid!, $payload: jsonb!) {
       insert_watched_events_one(object: {org_id: $orgId, source: "support_inbox", payload: $payload}) { id }
     }`,
    { orgId: orgA.id, payload: { message: 'Total outage, nothing loads, this is unacceptable.' } },
  );
  ok('watched_events row inserted', Boolean(inserted.data?.insert_watched_events_one?.id), err(inserted));

  let afterCount = beforeCount;
  for (let i = 0; i < 20 && afterCount <= beforeCount; i += 1) {
    await sleep(2000);
    const after = await gql(
      ownerA,
      'owner',
      `query ($id: uuid!) { workflow_runs_aggregate(where: {workflow_id: {_eq: $id}, trigger_type: {_eq: "database_event"}}) { aggregate { count } } }`,
      { id: workflow.id },
    );
    afterCount = after.data?.workflow_runs_aggregate?.aggregate?.count ?? 0;
  }
  ok('Hasura Event Trigger auto-started a run', afterCount > beforeCount, `${beforeCount} -> ${afterCount}`);

  console.log('\n[8] Quota accounting');
  const usage = await gql(
    ownerA,
    'owner',
    `query ($id: uuid!) {
       org_usage(where: {org_id: {_eq: $id}}) {
         quota_used quota_limit runs_this_period completed_runs paused_runs avg_run_seconds llm_calls_this_period
       }
     }`,
    { id: orgA.id },
  );
  console.log(`      ${JSON.stringify(usage.data?.org_usage?.[0])}`);
  ok('org_usage view is readable and moving', (usage.data?.org_usage?.[0]?.runs_this_period ?? 0) > 0);

  console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('\ne2e crashed:', e.message);
  process.exit(1);
});
