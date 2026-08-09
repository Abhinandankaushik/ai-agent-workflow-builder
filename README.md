# AI Agent Workflow Builder

A mini n8n for chaining AI agent steps, built on **nhost (Postgres + Hasura + Auth)** with a
**Next.js** frontend that also hosts the Hasura Action / Event Trigger / Cron handlers.

Organizations own workflows. Workflows are ordered steps of six types, started four different ways,
and every action is checked against **two independent permission layers** — one in Hasura row
permissions, one inside the Action handlers.

---

## What's in here

```
hasura/migrations/default/1700000000000_init/   schema, view, computed fields, guard triggers
hasura/metadata.json                            snapshot of the applied Hasura metadata
scripts/metadata.mjs                            source of truth for tables/permissions/actions/crons
scripts/setup.mjs                               applies SQL + merges metadata into nhost's
scripts/seed.mjs                                creates the two demo orgs, four users, demo workflow
web/                                            Next.js app + all handlers
  src/app/api/actions/*                         triggerWorkflowRun, approveStep, webhook, inviteMember
  src/app/api/events/*                          notify dispatch, watched-row -> run
  src/app/api/cron/scheduler                    scheduled triggers
  src/server/engine/*                           the workflow engine (retry, branching, pause/resume)
```

---

## Step types

| type | what it does |
|---|---|
| `llm_call` | real call to Groq (`llama-3.3-70b-versatile`); falls back to a disclosed stub with an artificial delay when no key is set |
| `http_request` | any external HTTP call, JSON-parsed, non-2xx retried |
| `db_write` | writes into `workflow_artifacts` (a sandbox table — a step can never name an arbitrary table) |
| `notify` | inserts into `notifications`; a **Hasura Event Trigger** delivers it to Slack |
| `conditional_branch` | compares a templated value and continues / stops / jumps to another position |
| `approval_gate` | pauses the run until someone with the right role approves via the `approveStep` Action |

Steps reference earlier results with `{{run.input.x}}`, `{{prev.output.x}}` and
`{{steps.<step name>.output.x}}`.

## Trigger types

| type | how it fires |
|---|---|
| `manual` | Run button → `triggerWorkflowRun` Action |
| `webhook` | unauthenticated `triggerWorkflowWebhook` Action, verified against a per-trigger secret |
| `scheduled` | Hasura cron trigger every minute → `/api/cron/scheduler` decides which are due |
| `database_event` | insert into `watched_events` → Hasura Event Trigger → starts matching workflows |

---

## Local setup

**Prerequisites:** Node 20+, an nhost project, a Groq API key (optional), a Slack incoming webhook
(optional).

### 1. nhost project settings

In the nhost dashboard:

* **Settings → Auth → Sign-In Methods**: turn *off* "Require verified emails" so demo users can sign
  in immediately.
* **Settings → Roles and Permissions**: add `owner`, `editor` and `viewer` to the **default allowed
  roles** (alongside `user` and `me`).
  These are only *requestable* roles — see the write-up for why that is safe.
* **Settings → Hasura**: copy the **admin secret**.

### 2. Configure

```bash
cp .env.example .env
```

```dotenv
NHOST_SUBDOMAIN=your-subdomain
NHOST_REGION=your-region
HASURA_ADMIN_SECRET=...
HANDLER_BASE_URL=http://localhost:3000     # or your Vercel URL
ACTION_SECRET=<long random string>
GROQ_API_KEY=gsk_...                       # optional; stub used if empty
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...   # optional
```

### 3. Apply schema + metadata, then seed

```bash
npm run setup     # drops & recreates the schema, merges metadata into nhost's, writes web/.env.local
npm run seed      # two orgs, four users, one 6-step demo workflow
```

`npm run setup` is destructive by design (it re-runs `down.sql` first). Use
`npm run setup:metadata` to re-apply metadata only — for example after changing `HANDLER_BASE_URL`.

### 4. Run

```bash
cd web && npm install && npm run dev
```

Open http://localhost:3000.

> **Note on local handlers:** Hasura Cloud (inside nhost) has to reach `HANDLER_BASE_URL` over the
> public internet. For local development either point `HANDLER_BASE_URL` at a tunnel
> (`npx localtunnel --port 3000`, ngrok, …) and re-run `npm run setup:metadata`, or simply point it
> at your deployed Vercel URL and develop the UI locally against the deployed handlers.

### Seeded logins

Password for all: `Password123!`

| email | org | role |
|---|---|---|
| `owner.a@demo.dev` | Acme AI (Org A) | owner |
| `editor.a@demo.dev` | Acme AI (Org A) | editor |
| `viewer.a@demo.dev` | Acme AI (Org A) | viewer |
| `owner.b@demo.dev` | Globex (Org B) | owner |

---

## Deploying to Vercel

1. Push this repo to GitHub.
2. Import it in Vercel with **Root Directory = `web`**.
3. Set these environment variables in Vercel:

   ```
   NEXT_PUBLIC_NHOST_SUBDOMAIN, NEXT_PUBLIC_NHOST_REGION,
   NHOST_SUBDOMAIN, NHOST_REGION, HASURA_ADMIN_SECRET, ACTION_SECRET,
   GROQ_API_KEY, GROQ_MODEL, SLACK_WEBHOOK_URL
   ```

4. Deploy, then locally set `HANDLER_BASE_URL=https://<your-app>.vercel.app` in `.env` and run
   `npm run setup:metadata` so Hasura points its Actions, Event Triggers and cron at the deployed
   handlers.
5. Add the Vercel URL to **nhost → Settings → Auth → Allowed redirect URLs**.

---

## The Final Task walkthrough

1. **Two orgs exist** — sign in as `owner.a@demo.dev` (Acme AI) and `owner.b@demo.dev` (Globex).
2. **Org A owner builds a workflow** — "Support ticket triage" has `llm_call` → `conditional_branch`
   → `http_request` → `approval_gate` → `db_write` → `notify`. The branch reads the LLM's JSON: a
   `NEGATIVE` sentiment runs the enrichment HTTP call, a `POSITIVE` one skips straight to approval.
3. **Two ways to start it** — the **Run** button, and either the webhook `curl` shown on the
   workflow page (owner-only, secret-verified) or the **Fire a database event** panel on the
   dashboard.
4. **It pauses** — the run stops at *Human sign-off*. Sign in as `editor.a@demo.dev` and approve;
   `viewer.a@demo.dev` has no approve button and the Action rejects them anyway.
5. **Live status** — the run page streams `step_runs` over a GraphQL subscription; no refresh.
6. **Cross-org isolation** — as `owner.b@demo.dev`, paste an Org A workflow or run id into the URL.
   Every query returns empty and both `triggerWorkflowRun` and `approveStep` fail with
   *"You do not have access to this…"*, because the handlers re-derive membership from `org_members`
   rather than trusting the request.

## Write-up

See [WRITEUP.md](./WRITEUP.md) for schema reasoning, how the two permission layers differ, and how
pause/resume is implemented.
