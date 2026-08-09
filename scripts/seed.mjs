// Creates the exact fixture the Final Task walkthrough needs:
//   Org A (Acme AI)  -> owner / editor / viewer
//   Org B (Globex)   -> owner  (used to prove cross-org isolation)
// plus a 6-step demo workflow in Org A with manual + webhook + db-event triggers.

import { loadEnv, adminGraphql } from './lib.mjs';

const env = loadEnv();

const PASSWORD = process.env.SEED_PASSWORD || 'Password123!';

const USERS = [
  { key: 'ownerA', email: 'owner.a@demo.dev', displayName: 'Aisha - Acme owner' },
  { key: 'editorA', email: 'editor.a@demo.dev', displayName: 'Eshan - Acme editor' },
  { key: 'viewerA', email: 'viewer.a@demo.dev', displayName: 'Vikram - Acme viewer' },
  { key: 'ownerB', email: 'owner.b@demo.dev', displayName: 'Bhavna - Globex owner' },
];

async function ensureUser({ email, displayName }) {
  const res = await fetch(`${env.authUrl}/signup/email-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, options: { displayName } }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (!/already|exists|conflict/i.test(body)) {
      throw new Error(`signup ${email} failed: ${body.slice(0, 300)}`);
    }
  }
  const { users } = await adminGraphql(
    env,
    `query ($email: citext!) { users(where: {email: {_eq: $email}}) { id email } }`,
    { email },
  );
  if (!users.length) throw new Error(`user ${email} was not created`);
  // demo fixtures must be able to sign in without a mailbox
  await adminGraphql(
    env,
    `mutation ($id: uuid!) {
       updateUser(pk_columns: {id: $id}, _set: {emailVerified: true, disabled: false}) { id }
     }`,
    { id: users[0].id },
  );
  return users[0].id;
}

async function resetDemoData() {
  await adminGraphql(
    env,
    `mutation {
       delete_organizations(where: {slug: {_in: ["acme-ai", "globex"]}}) { affected_rows }
     }`,
  );
}

async function createOrg({ name, slug, quota_limit }) {
  const { insert_organizations_one } = await adminGraphql(
    env,
    `mutation ($obj: organizations_insert_input!) {
       insert_organizations_one(object: $obj) { id name slug }
     }`,
    { obj: { name, slug, quota_limit } },
  );
  return insert_organizations_one;
}

async function addMember(org_id, user_id, role) {
  await adminGraphql(
    env,
    `mutation ($obj: org_members_insert_input!) {
       insert_org_members_one(object: $obj,
         on_conflict: {constraint: org_members_org_id_user_id_key, update_columns: [role]}) { id }
     }`,
    { obj: { org_id, user_id, role } },
  );
}

function demoSteps(workflow_id, created_by) {
  return [
    {
      workflow_id,
      created_by,
      position: 0,
      name: 'Classify support ticket',
      type: 'llm_call',
      config: {
        model: 'llama-3.3-70b-versatile',
        temperature: 0,
        max_tokens: 300,
        system:
          'You are a triage assistant. Reply with STRICT JSON only, no markdown fences: ' +
          '{"sentiment":"POSITIVE"|"NEGATIVE","urgency":"low"|"high","summary":"<one sentence>"}',
        prompt:
          'Classify this customer message and summarise it:\n\n"{{run.input.message}}"',
        parse_json: true,
      },
    },
    {
      workflow_id,
      created_by,
      position: 1,
      name: 'Negative ticket?',
      type: 'conditional_branch',
      config: {
        left: '{{steps.Classify support ticket.output.json.sentiment}}',
        operator: 'equals',
        right: 'NEGATIVE',
        if_true: { action: 'continue' },
        // happy customers skip the enrichment call and go straight to approval
        if_false: { action: 'skip_to', position: 3 },
      },
    },
    {
      workflow_id,
      created_by,
      position: 2,
      name: 'Fetch escalation policy',
      type: 'http_request',
      config: {
        method: 'GET',
        url: 'https://api.github.com/repos/hasura/graphql-engine',
        headers: { accept: 'application/vnd.github+json' },
        parse_json: true,
      },
    },
    {
      workflow_id,
      created_by,
      position: 3,
      name: 'Human sign-off',
      type: 'approval_gate',
      config: {
        approver_role: 'editor',
        message: 'Review the triage result before it is written and announced.',
      },
    },
    {
      workflow_id,
      created_by,
      position: 4,
      name: 'Persist triage result',
      type: 'db_write',
      config: {
        key: 'triage_result',
        payload: {
          sentiment: '{{steps.Classify support ticket.output.json.sentiment}}',
          urgency: '{{steps.Classify support ticket.output.json.urgency}}',
          summary: '{{steps.Classify support ticket.output.json.summary}}',
          original: '{{run.input.message}}',
        },
      },
    },
    {
      workflow_id,
      created_by,
      position: 5,
      name: 'Announce on Slack',
      type: 'notify',
      config: {
        channel: 'slack',
        message:
          'Triage complete — sentiment {{steps.Classify support ticket.output.json.sentiment}}: ' +
          '{{steps.Classify support ticket.output.json.summary}}',
      },
    },
  ];
}

async function createWorkflow(org, created_by) {
  const { insert_workflows_one } = await adminGraphql(
    env,
    `mutation ($obj: workflows_insert_input!) {
       insert_workflows_one(object: $obj) { id name }
     }`,
    {
      obj: {
        org_id: org.id,
        created_by,
        name: 'Support ticket triage',
        description:
          'LLM classifies an inbound message, branches on sentiment, waits for human sign-off, ' +
          'then persists the result and announces it.',
      },
    },
  );
  const workflow = insert_workflows_one;

  await adminGraphql(
    env,
    `mutation ($objs: [workflow_steps_insert_input!]!) {
       insert_workflow_steps(objects: $objs) { affected_rows }
     }`,
    { objs: demoSteps(workflow.id, created_by) },
  );

  const { insert_workflow_triggers } = await adminGraphql(
    env,
    `mutation ($objs: [workflow_triggers_insert_input!]!) {
       insert_workflow_triggers(objects: $objs) { returning { id type webhook_secret } }
     }`,
    {
      objs: [
        { workflow_id: workflow.id, created_by, type: 'manual', config: {} },
        { workflow_id: workflow.id, created_by, type: 'webhook', config: { source: 'external-crm' } },
        {
          workflow_id: workflow.id,
          created_by,
          type: 'database_event',
          config: { source: 'support_inbox', message_path: 'message' },
        },
        {
          workflow_id: workflow.id,
          created_by,
          type: 'scheduled',
          is_active: false,
          cron: '*/15 * * * *',
          config: { message: 'Scheduled health check ticket: everything looks great, thanks!' },
        },
      ],
    },
  );

  return { workflow, triggers: insert_workflow_triggers.returning };
}

(async () => {
  console.log('\n› creating demo users');
  const ids = {};
  for (const u of USERS) {
    ids[u.key] = await ensureUser(u);
    console.log(`  ${u.email}  ->  ${ids[u.key]}`);
  }

  console.log('› resetting demo orgs');
  await resetDemoData();

  const orgA = await createOrg({ name: 'Acme AI', slug: 'acme-ai', quota_limit: 50 });
  const orgB = await createOrg({ name: 'Globex', slug: 'globex', quota_limit: 50 });
  console.log(`  Org A ${orgA.id}\n  Org B ${orgB.id}`);

  await addMember(orgA.id, ids.ownerA, 'owner');
  await addMember(orgA.id, ids.editorA, 'editor');
  await addMember(orgA.id, ids.viewerA, 'viewer');
  await addMember(orgB.id, ids.ownerB, 'owner');

  const { workflow, triggers } = await createWorkflow(orgA, ids.ownerA);
  const webhook = triggers.find((t) => t.type === 'webhook');

  console.log(`\n  Workflow: ${workflow.name} (${workflow.id})`);
  console.log('\n────────────────────────────────────────────────────────');
  console.log(`  Sign in with password: ${PASSWORD}`);
  USERS.forEach((u) => console.log(`    ${u.email.padEnd(20)} ${u.displayName}`));
  console.log('\n  Webhook trigger (call from anywhere, no auth):');
  console.log(`    POST ${env.graphqlUrl}`);
  console.log(
    `    { "query": "mutation($t:uuid!,$s:String!,$p:jsonb){triggerWorkflowWebhook(trigger_id:$t,secret:$s,payload:$p){run_id status}}",`,
  );
  console.log(
    `      "variables": { "t": "${webhook.id}", "s": "${webhook.webhook_secret}", "p": { "message": "This is broken and I am furious" } } }`,
  );
  console.log('────────────────────────────────────────────────────────\n');
})().catch((err) => {
  console.error('\nSeed failed:\n', err.message);
  process.exit(1);
});
