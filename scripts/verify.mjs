// End-to-end proof of the two permission layers, run against the live project
// as the four seeded users. No admin secret is used for any assertion.
//
//   node scripts/verify.mjs

import { loadEnv, adminGraphql } from './lib.mjs';

const env = loadEnv();
const PASSWORD = process.env.SEED_PASSWORD || 'Password123!';

let passed = 0;
let failed = 0;

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function signIn(email) {
  const res = await fetch(`${env.authUrl}/signin/email-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const json = await res.json();
  if (!json.session) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(json).slice(0, 200)}`);
  return json.session.accessToken;
}

async function gql(token, role, query, variables = {}) {
  const res = await fetch(env.graphqlUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(role ? { 'x-hasura-role': role } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

/** Unauthenticated call — how an external system hits the inbound webhook. */
async function anonGql(query, variables = {}) {
  const res = await fetch(env.graphqlUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

const errorText = (r) => (r.errors ?? []).map((e) => e.message).join('; ');

(async () => {
  const ctx = await adminGraphql(
    env,
    `query {
       orgA: organizations(where: {slug: {_eq: "acme-ai"}}) {
         id
         workflows { id name steps(order_by: {position: asc}) { id name type position } }
       }
       orgB: organizations(where: {slug: {_eq: "globex"}}) { id }
     }`,
  );
  const orgA = ctx.orgA[0];
  const orgB = ctx.orgB[0];
  const workflowA = orgA.workflows[0];

  const tokens = {
    ownerA: await signIn('owner.a@demo.dev'),
    editorA: await signIn('editor.a@demo.dev'),
    viewerA: await signIn('viewer.a@demo.dev'),
    ownerB: await signIn('owner.b@demo.dev'),
  };

  console.log('\nLayer 1 — org + role scoping');

  const ownerASees = await gql(tokens.ownerA, 'owner', `query { workflows { id } }`);
  check('Org A owner sees Org A workflows', ownerASees.data?.workflows?.length >= 1, errorText(ownerASees));

  const viewerASees = await gql(tokens.viewerA, 'viewer', `query { workflows { id } }`);
  check('Org A viewer can read workflows', viewerASees.data?.workflows?.length >= 1, errorText(viewerASees));

  const ownerBSees = await gql(tokens.ownerB, 'owner', `query { workflows { id } }`);
  check('Org B owner sees zero Org A workflows', ownerBSees.data?.workflows?.length === 0, errorText(ownerBSees));

  const guessById = await gql(
    tokens.ownerB,
    'owner',
    `query ($id: uuid!) { workflows_by_pk(id: $id) { id name } }`,
    { id: workflowA.id },
  );
  check(
    'Org B owner cannot fetch an Org A workflow by guessing its id',
    guessById.data?.workflows_by_pk === null,
    errorText(guessById) || JSON.stringify(guessById.data),
  );

  const orgBRuns = await gql(
    tokens.ownerB,
    'owner',
    `query ($id: uuid!) { step_runs(where: {run: {workflow_id: {_eq: $id}}}) { id } }`,
    { id: workflowA.id },
  );
  check(
    'Org B owner cannot subscribe to Org A step_runs',
    orgBRuns.data?.step_runs?.length === 0,
    errorText(orgBRuns),
  );

  const escalate = await gql(
    tokens.viewerA,
    'owner',
    `query { workflows { id } }`,
  );
  check(
    'Org A viewer asking for the owner role still sees nothing',
    escalate.data?.workflows?.length === 0,
    errorText(escalate),
  );

  const viewerWrite = await gql(
    tokens.viewerA,
    'viewer',
    `mutation ($orgId: uuid!) { insert_workflows_one(object: {org_id: $orgId, name: "nope"}) { id } }`,
    { orgId: orgA.id },
  );
  check('Org A viewer cannot create a workflow', Boolean(viewerWrite.errors), 'mutation succeeded');

  const crossOrgWrite = await gql(
    tokens.ownerB,
    'owner',
    `mutation ($orgId: uuid!) { insert_workflows_one(object: {org_id: $orgId, name: "nope"}) { id } }`,
    { orgId: orgA.id },
  );
  check('Org B owner cannot create a workflow inside Org A', Boolean(crossOrgWrite.errors), 'mutation succeeded');

  console.log('\nLayer 2 — step-level gating');

  const editorPrivileged = await gql(
    tokens.editorA,
    'editor',
    `mutation ($wf: uuid!) {
       insert_workflow_steps_one(object: {workflow_id: $wf, name: "sneaky", type: "db_write", position: 99, config: {}}) { id }
     }`,
    { wf: workflowA.id },
  );
  check('Editor cannot add a db_write step', Boolean(editorPrivileged.errors), 'insert succeeded');

  const editorNotify = await gql(
    tokens.editorA,
    'editor',
    `mutation ($wf: uuid!) {
       insert_workflow_steps_one(object: {workflow_id: $wf, name: "sneaky", type: "notify", position: 98, config: {}}) { id }
     }`,
    { wf: workflowA.id },
  );
  check('Editor cannot add a notify step', Boolean(editorNotify.errors), 'insert succeeded');

  const editorWebhook = await gql(
    tokens.editorA,
    'editor',
    `mutation ($wf: uuid!) {
       insert_workflow_triggers_one(object: {workflow_id: $wf, type: "webhook"}) { id }
     }`,
    { wf: workflowA.id },
  );
  check('Editor cannot add a webhook trigger', Boolean(editorWebhook.errors), 'insert succeeded');

  const editorAllowed = await gql(
    tokens.editorA,
    'editor',
    `mutation ($wf: uuid!) {
       insert_workflow_steps_one(object: {workflow_id: $wf, name: "editor http", type: "http_request", position: 97, config: {url: "https://example.com"}}) { id }
     }`,
    { wf: workflowA.id },
  );
  check(
    'Editor CAN add a normal http_request step',
    Boolean(editorAllowed.data?.insert_workflow_steps_one?.id),
    errorText(editorAllowed),
  );
  if (editorAllowed.data?.insert_workflow_steps_one?.id) {
    await gql(
      tokens.editorA,
      'editor',
      `mutation ($id: uuid!) { delete_workflow_steps_by_pk(id: $id) { id } }`,
      { id: editorAllowed.data.insert_workflow_steps_one.id },
    );
  }

  const editorSecret = await gql(
    tokens.editorA,
    'editor',
    `query { workflow_triggers { webhook_secret } }`,
  );
  check('Editor cannot read a webhook secret column', Boolean(editorSecret.errors), 'query succeeded');

  console.log('\nActions');

  const viewerRun = await gql(
    tokens.viewerA,
    'viewer',
    `mutation ($id: uuid!) { triggerWorkflowRun(workflow_id: $id) { run_id } }`,
    { id: workflowA.id },
  );
  check('Viewer cannot call triggerWorkflowRun', Boolean(viewerRun.errors), 'action succeeded');

  const crossOrgRun = await gql(
    tokens.ownerB,
    'owner',
    `mutation ($id: uuid!) { triggerWorkflowRun(workflow_id: $id) { run_id status } }`,
    { id: workflowA.id },
  );
  check(
    'Org B owner cannot trigger an Org A workflow by id',
    Boolean(crossOrgRun.errors),
    JSON.stringify(crossOrgRun.data),
  );

  const badWebhook = await anonGql(
    `mutation ($t: uuid!, $s: String!) { triggerWorkflowWebhook(trigger_id: $t, secret: $s) { run_id } }`,
    { t: workflowA.id, s: 'not-the-secret' },
  );
  check('Webhook Action rejects a wrong secret', Boolean(badWebhook.errors), JSON.stringify(badWebhook.data));

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('\nVerification crashed:\n', err.message);
  process.exit(1);
});
