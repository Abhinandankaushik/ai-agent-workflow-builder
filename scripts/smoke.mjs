// Drives the whole engine by replaying the exact payload Hasura sends to the
// Action handlers. Works against a local dev server (no tunnel needed) or a
// deployed one:
//
//   node scripts/smoke.mjs                       -> http://localhost:3000
//   node scripts/smoke.mjs https://app.vercel.app
import { loadEnv, adminGraphql } from './lib.mjs';

const env = loadEnv();
const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');

const ctx = await adminGraphql(
  env,
  `query {
     organizations(where: {slug: {_eq: "acme-ai"}}) {
       id
       workflows { id name }
       members { user_id role }
     }
   }`,
);
const org = ctx.organizations[0];
const workflow = org.workflows[0];
const owner = org.members.find((m) => m.role === 'owner');
const editor = org.members.find((m) => m.role === 'editor');

async function callAction(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-action-secret': env.actionSecret },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

console.log('\n1) trigger the run as the Org A owner');
const start = await callAction('/api/actions/trigger-workflow-run', {
  action: { name: 'triggerWorkflowRun' },
  input: { workflow_id: workflow.id, input: { message: 'The app keeps crashing and I am furious about it.' } },
  session_variables: { 'x-hasura-user-id': owner.user_id, 'x-hasura-role': 'owner' },
});
console.log('  ', start.status, JSON.stringify(start.body));

const runId = start.body.run_id;
if (!runId) process.exit(1);

const stepQuery = `query ($id: uuid!) {
  workflow_runs_by_pk(id: $id) {
    status cursor error
    step_runs(order_by: {position: asc}) { position name type status attempt_count error output }
  }
}`;

async function dump(label) {
  const d = await adminGraphql(env, stepQuery, { id: runId });
  const run = d.workflow_runs_by_pk;
  console.log(`\n${label}  run=${run.status}${run.error ? ` err=${run.error}` : ''}`);
  for (const s of run.step_runs) {
    const out = s.output ? JSON.stringify(s.output).slice(0, 110) : '';
    console.log(`   ${s.position} ${s.name.padEnd(26)} ${s.type.padEnd(19)} ${s.status.padEnd(18)} a${s.attempt_count} ${out}`);
    if (s.error) console.log(`      error: ${s.error}`);
  }
  return run;
}

const paused = await dump('2) after trigger');

console.log('\n3) cross-org + viewer checks against the handler');
const viewer = org.members.find((m) => m.role === 'viewer');
const bad = await callAction('/api/actions/trigger-workflow-run', {
  action: { name: 'triggerWorkflowRun' },
  input: { workflow_id: workflow.id },
  session_variables: { 'x-hasura-user-id': viewer.user_id, 'x-hasura-role': 'owner' },
});
console.log('   viewer claiming owner ->', bad.status, JSON.stringify(bad.body));

const gate = paused.step_runs.find((s) => s.status === 'awaiting_approval');
if (gate) {
  const gateRow = await adminGraphql(
    env,
    `query ($id: uuid!) { step_runs(where: {workflow_run_id: {_eq: $id}, type: {_eq: "approval_gate"}}) { id } }`,
    { id: runId },
  );
  const stepRunId = gateRow.step_runs[0].id;

  console.log('\n4) viewer tries to approve');
  const viewerApprove = await callAction('/api/actions/approve-step', {
    action: { name: 'approveStep' },
    input: { step_run_id: stepRunId, decision: 'approve' },
    session_variables: { 'x-hasura-user-id': viewer.user_id, 'x-hasura-role': 'editor' },
  });
  console.log('   ', viewerApprove.status, JSON.stringify(viewerApprove.body));

  console.log('\n5) editor approves and the run resumes');
  const approve = await callAction('/api/actions/approve-step', {
    action: { name: 'approveStep' },
    input: { step_run_id: stepRunId, decision: 'approve', note: 'looks right' },
    session_variables: { 'x-hasura-user-id': editor.user_id, 'x-hasura-role': 'editor' },
  });
  console.log('   ', approve.status, JSON.stringify(approve.body));
  await dump('6) after approval');
}

const usage = await adminGraphql(
  env,
  `query ($id: uuid!) { org_usage(where: {org_id: {_eq: $id}}) { quota_used quota_limit runs_this_period completed_runs avg_run_seconds llm_calls_this_period } }`,
  { id: org.id },
);
console.log('\n7) org_usage view:', JSON.stringify(usage.org_usage[0]));

const arts = await adminGraphql(
  env,
  `query ($id: uuid!) {
     workflow_artifacts(where: {workflow_run_id: {_eq: $id}}) { key payload }
     notifications(where: {workflow_run_id: {_eq: $id}}) { channel message status error }
   }`,
  { id: runId },
);
console.log('8) artifacts:', JSON.stringify(arts.workflow_artifacts));
console.log('   notifications:', JSON.stringify(arts.notifications));
