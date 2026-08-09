# Design write-up

## Schema reasoning

The chain `organizations → org_members → workflows → {workflow_steps, workflow_triggers}` and
`workflows → workflow_runs → step_runs` is the backbone. Three deliberate choices shape it:

**`org_members` is the only source of authority.** There is no global role anywhere — a role is a
column on the *membership* row, so the same person is an owner in Acme AI and a viewer in Globex
without any special casing. Every permission in the system is ultimately a predicate over this table.

**Run tables carry a denormalised `org_id`.** `workflow_runs` and `step_runs` could reach their org
through `workflow → organization`, but a permission on `step_runs` would then be a three-table join
evaluated on every row of a live subscription. Denormalising it makes the hot path
`org_id → org_members` and keeps the subscription cheap. The column is written only by the engine.

**`step_runs` copies `name`, `type` and `position` off the step.** Editing a workflow replaces its
steps, and `step_runs.step_id` is `ON DELETE SET NULL`, so historical runs stay readable exactly as
they executed instead of being rewritten by a later edit.

Two more pieces exist to keep side effects inside the sandbox: `workflow_artifacts` is the *only*
table a `db_write` step can target (the step config names a key, never a table), and `notifications`
is an outbox that a Hasura Event Trigger drains — so the `notify` step type is genuinely
event-driven and a broken Slack never stalls a run.

The aggregation is the `org_usage` view: quota consumed/remaining for the period plus runs started,
completed, failed, paused, average run duration and LLM call count. `workflows` additionally exposes
two computed fields, `latest_run_status` and `run_count`, so the workflow list needs no client-side
joins.

---

## The two permission layers, and why they are enforced differently

### Layer 1 — org + role scoping, in Hasura row permissions

Hasura roles `owner`, `editor` and `viewer` exist, and every user is allowed to *request* any of
them. That sounds alarming until you look at what a permission filter actually says:

```yaml
# workflows, role: editor
filter:
  organization:
    members:
      user_id: { _eq: X-Hasura-User-Id }
      role:    { _eq: editor }
```

The requested role is not the grant. The row is only visible if a row exists in `org_members` tying
**this caller** to **this org** with **that role**. So the JWT role is a *scope selector*, and the
database is the authority. An Org B editor asking for `x-hasura-role: owner` on an Org A workflow
matches nothing — there is no membership row to satisfy either half of the predicate.

This makes ID guessing structurally useless rather than defensively patched: `workflows_by_pk(id:
<org A id>)` from an Org B session returns `null`, and so do the run and step-run subscriptions.

`workflow_runs` and `step_runs` deliberately have **no insert or update permission for any client
role at all**. Runs can only be created and mutated by the Action handlers with the admin secret.
That is what makes "a viewer cannot trigger a run" absolute instead of a UI convention — there is no
mutation for a viewer to call, and `triggerWorkflowRun`'s Action permission does not list `viewer`.

### Layer 2 — step-level gating, which row permissions cannot fully express

Some step types reach outside the sandbox, so they are owner-only. That has three enforcement
points, each catching what the previous one cannot:

1. **Row permission** — the `editor` insert/update check on `workflow_steps` carries
   `type: {_nin: [db_write, notify]}`, and on `workflow_triggers` `type: {_nin: [webhook]}`. An
   editor's mutation is rejected by Hasura before it reaches Postgres.
2. **Postgres BEFORE trigger** — `assert_owner_for_privileged_step` re-checks the same rule from
   `current_setting('hasura.user')`, so the rule survives any path that bypasses Hasura permissions.
3. **The engine, at execution time** — before running a `db_write` or `notify` step, the engine
   verifies the step's `created_by` is *still* an owner of the run's org. A step authored by someone
   who has since been demoted stops executing. No row permission can express that, because the check
   happens mid-run against a row nobody is currently reading.

**The approval gate is the clearest case.** Clearing it is not a read or a write of a row — it is a
decision about whether an in-flight run may continue. `approveStep` therefore does the checking
itself:

* Layer 1: `requireMembership(userId, stepRun.org_id, ['owner','editor'])` — re-derived from
  `org_members` with the admin client, so a forged or borrowed role claim is irrelevant.
* Layer 2: the gate's own `config.approver_role` decides whether an editor suffices or only an owner
  will do, and that is compared against the membership role just resolved.

Both failures return the same message a non-member gets, so the endpoint never confirms that a given
step-run id exists in some other org.

---

## How the approval-gate pause/resume works

A run is a cursor over its `step_runs`. `workflow_runs.cursor` holds the index the engine is at, and
all `step_runs` rows are created up front (status `pending`) so a subscriber sees the whole plan
immediately rather than watching rows appear.

**Pause.** When the loop in `advanceRun` reaches a step of type `approval_gate`, it does not execute
anything. It sets that `step_run` to `awaiting_approval`, sets the run to `paused` with
`cursor = <that index>`, and returns. The `triggerWorkflowRun` Action responds normally with
`status: "paused"` — no thread is held open, nothing is polling, and the run is durable across
deploys because its entire state is in the two rows.

**The UI notices without asking.** The run page holds two subscriptions: one on `workflow_runs_by_pk`
for overall status, and the required one on `step_runs` filtered to `workflow_run_id`. The pause is
just another row update, so the "paused — awaiting approval" card and the approve controls appear in
the same stream that showed the previous step succeed.

**Resume.** `approveStep` validates both layers, stamps `approved_by` / `approved_at` /
`approval_note` on the step run and marks it `succeeded`, advances `workflow_runs.cursor` to
`position + 1`, flips the run back to `running`, and calls the *same* `advanceRun` function the
initial trigger used. The engine rebuilds its template context from the outputs already stored on the
completed `step_runs`, so the resumed half sees exactly what the first half produced. A rejection
takes the mirror path: the step becomes `rejected`, remaining steps become `skipped`, and the run
becomes `cancelled`.

Because resume is the same entry point as start, there is one execution path to reason about — and
retry, branching and quota accounting behave identically on both sides of the pause.

---

## Failure handling and quota

`llm_call` and `http_request` retry once with a 600 ms backoff; `attempt_count` and the intermediate
error are written to the `step_run` on every attempt, so a retry is visible in the live stream rather
than hidden. Permission failures (`HandlerError`) are never retried — they are not transient. When a
step exhausts its attempts, the step fails, every remaining step is marked `skipped`, and the run
fails with the message.

Quota is checked before a run is created (`quota_used >= quota_limit` rejects with
`quota_exceeded`) and consumed on completion through `consume_org_quota`, which takes a row lock and
does the check-and-increment atomically so parallel completions cannot overshoot the limit.
`roll_quota_period` resets the counter when the calendar month rolls over.
