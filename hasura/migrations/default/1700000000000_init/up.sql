-- AI Agent Workflow Builder :: core schema
-- Runs on the nhost "default" Postgres database (auth.users already exists).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------- organizations
CREATE TABLE public.organizations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL,
  slug               text NOT NULL UNIQUE,
  quota_limit        integer NOT NULL DEFAULT 100 CHECK (quota_limit >= 0),
  quota_used         integer NOT NULL DEFAULT 0 CHECK (quota_used >= 0),
  quota_period_start date NOT NULL DEFAULT date_trunc('month', now())::date,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------- org_members
CREATE TABLE public.org_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);
CREATE INDEX org_members_user_idx ON public.org_members (user_id);
CREATE INDEX org_members_org_idx  ON public.org_members (org_id);
CREATE TRIGGER org_members_set_updated_at BEFORE UPDATE ON public.org_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------- workflows
CREATE TABLE public.workflows (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_active   boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflows_org_idx ON public.workflows (org_id);
CREATE TRIGGER workflows_set_updated_at BEFORE UPDATE ON public.workflows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------- workflow_steps
CREATE TABLE public.workflow_steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  name        text NOT NULL,
  type        text NOT NULL CHECK (type IN (
                'llm_call', 'http_request', 'db_write',
                'notify', 'conditional_branch', 'approval_gate')),
  position    integer NOT NULL CHECK (position >= 0),
  config      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflow_steps_workflow_idx ON public.workflow_steps (workflow_id, position);
CREATE TRIGGER workflow_steps_set_updated_at BEFORE UPDATE ON public.workflow_steps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------- workflow_triggers
CREATE TABLE public.workflow_triggers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id    uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  type           text NOT NULL CHECK (type IN ('manual', 'webhook', 'scheduled', 'database_event')),
  config         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- webhook triggers authenticate with this secret instead of a user JWT
  webhook_secret text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  cron           text,
  last_fired_at  timestamptz,
  is_active      boolean NOT NULL DEFAULT true,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflow_triggers_workflow_idx ON public.workflow_triggers (workflow_id);
CREATE INDEX workflow_triggers_type_idx     ON public.workflow_triggers (type) WHERE is_active;
CREATE TRIGGER workflow_triggers_set_updated_at BEFORE UPDATE ON public.workflow_triggers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------- workflow_runs
CREATE TABLE public.workflow_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id  uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  -- denormalised so run-level permissions never need a 3-table join
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN (
                 'pending', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  trigger_type text NOT NULL DEFAULT 'manual' CHECK (trigger_type IN (
                 'manual', 'webhook', 'scheduled', 'database_event')),
  trigger_id   uuid REFERENCES public.workflow_triggers(id) ON DELETE SET NULL,
  triggered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cursor       integer NOT NULL DEFAULT 0,
  input        jsonb NOT NULL DEFAULT '{}'::jsonb,
  output       jsonb,
  error        text,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflow_runs_workflow_idx ON public.workflow_runs (workflow_id, created_at DESC);
CREATE INDEX workflow_runs_org_idx      ON public.workflow_runs (org_id, created_at DESC);
CREATE TRIGGER workflow_runs_set_updated_at BEFORE UPDATE ON public.workflow_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------- step_runs
CREATE TABLE public.step_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id uuid NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  step_id         uuid REFERENCES public.workflow_steps(id) ON DELETE SET NULL,
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  type            text NOT NULL,
  position        integer NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN (
                    'pending', 'running', 'awaiting_approval',
                    'succeeded', 'failed', 'skipped', 'rejected')),
  input           jsonb,
  output          jsonb,
  error           text,
  attempt_count   integer NOT NULL DEFAULT 0,
  approved_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at     timestamptz,
  approval_note   text,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_run_id, position)
);
CREATE INDEX step_runs_run_idx ON public.step_runs (workflow_run_id, position);
CREATE TRIGGER step_runs_set_updated_at BEFORE UPDATE ON public.step_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------- db_write sandbox target
CREATE TABLE public.workflow_artifacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workflow_run_id uuid REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  step_run_id     uuid REFERENCES public.step_runs(id) ON DELETE CASCADE,
  key             text NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflow_artifacts_org_idx ON public.workflow_artifacts (org_id, created_at DESC);

-- ------------------------------------------- notify step -> Hasura Event Trigger
CREATE TABLE public.notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workflow_run_id uuid REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  step_run_id     uuid REFERENCES public.step_runs(id) ON DELETE CASCADE,
  channel         text NOT NULL DEFAULT 'slack' CHECK (channel IN ('slack', 'email')),
  target          text,
  message         text NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error           text,
  delivered_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_org_idx ON public.notifications (org_id, created_at DESC);
CREATE TRIGGER notifications_set_updated_at BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------ watched table -> DB event starts a run
CREATE TABLE public.watched_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source     text NOT NULL DEFAULT 'manual',
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX watched_events_org_idx ON public.watched_events (org_id, created_at DESC);

-- ============================================================================
-- Aggregation: org usage for the current quota period (tracked as a Hasura view)
-- ============================================================================
CREATE OR REPLACE VIEW public.org_usage AS
SELECT
  o.id                                                     AS org_id,
  o.name                                                   AS org_name,
  o.quota_limit,
  o.quota_used,
  GREATEST(o.quota_limit - o.quota_used, 0)                AS quota_remaining,
  o.quota_period_start,
  COALESCE(r.runs_this_period, 0)                          AS runs_this_period,
  COALESCE(r.completed_runs, 0)                            AS completed_runs,
  COALESCE(r.failed_runs, 0)                               AS failed_runs,
  COALESCE(r.paused_runs, 0)                               AS paused_runs,
  ROUND(COALESCE(r.avg_run_seconds, 0)::numeric, 2)        AS avg_run_seconds,
  COALESCE(s.llm_calls_this_period, 0)                     AS llm_calls_this_period,
  COALESCE(s.external_calls_this_period, 0)                AS external_calls_this_period
FROM public.organizations o
LEFT JOIN LATERAL (
  SELECT
    count(*)                                                        AS runs_this_period,
    count(*) FILTER (WHERE wr.status = 'completed')                 AS completed_runs,
    count(*) FILTER (WHERE wr.status = 'failed')                    AS failed_runs,
    count(*) FILTER (WHERE wr.status = 'paused')                    AS paused_runs,
    avg(EXTRACT(EPOCH FROM (wr.finished_at - wr.started_at)))
      FILTER (WHERE wr.finished_at IS NOT NULL)                     AS avg_run_seconds
  FROM public.workflow_runs wr
  WHERE wr.org_id = o.id AND wr.created_at >= o.quota_period_start
) r ON true
LEFT JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE sr.type = 'llm_call'  AND sr.status = 'succeeded') AS llm_calls_this_period,
    count(*) FILTER (WHERE sr.type IN ('llm_call', 'http_request'))           AS external_calls_this_period
  FROM public.step_runs sr
  WHERE sr.org_id = o.id AND sr.created_at >= o.quota_period_start
) s ON true;

-- ============================================================================
-- Computed field: latest run status for a workflow
-- ============================================================================
CREATE OR REPLACE FUNCTION public.workflow_latest_run_status(workflow_row public.workflows)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT wr.status
  FROM public.workflow_runs wr
  WHERE wr.workflow_id = workflow_row.id
  ORDER BY wr.created_at DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.workflow_run_count(workflow_row public.workflows)
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::int FROM public.workflow_runs wr WHERE wr.workflow_id = workflow_row.id;
$$;

-- ============================================================================
-- Layer 2 (defence in depth): privileged step / trigger types are owner-only.
-- Hasura column-level insert checks already block this, but a DB trigger makes
-- the rule hold even for a direct SQL / admin-secret path.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.assert_owner_for_privileged_step()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  actor    uuid := nullif(current_setting('hasura.user', true)::json ->> 'x-hasura-user-id', '')::uuid;
  hrole    text := current_setting('hasura.user', true)::json ->> 'x-hasura-role';
  target   uuid;
  is_owner boolean;
BEGIN
  IF NEW.type NOT IN ('db_write', 'notify') THEN
    RETURN NEW;
  END IF;
  -- the trusted server-side path (Action handlers) runs as admin
  IF hrole IS NULL OR hrole = 'admin' THEN
    RETURN NEW;
  END IF;
  SELECT w.org_id INTO target FROM public.workflows w WHERE w.id = NEW.workflow_id;
  SELECT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.org_id = target AND m.user_id = actor AND m.role = 'owner'
  ) INTO is_owner;
  IF NOT is_owner THEN
    RAISE EXCEPTION 'step type % may only be created by an org owner', NEW.type
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workflow_steps_privileged_guard
  BEFORE INSERT OR UPDATE ON public.workflow_steps
  FOR EACH ROW EXECUTE FUNCTION public.assert_owner_for_privileged_step();

CREATE OR REPLACE FUNCTION public.assert_owner_for_privileged_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  actor    uuid := nullif(current_setting('hasura.user', true)::json ->> 'x-hasura-user-id', '')::uuid;
  hrole    text := current_setting('hasura.user', true)::json ->> 'x-hasura-role';
  target   uuid;
  is_owner boolean;
BEGIN
  IF NEW.type <> 'webhook' THEN
    RETURN NEW;
  END IF;
  IF hrole IS NULL OR hrole = 'admin' THEN
    RETURN NEW;
  END IF;
  SELECT w.org_id INTO target FROM public.workflows w WHERE w.id = NEW.workflow_id;
  SELECT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.org_id = target AND m.user_id = actor AND m.role = 'owner'
  ) INTO is_owner;
  IF NOT is_owner THEN
    RAISE EXCEPTION 'webhook triggers may only be created by an org owner'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workflow_triggers_privileged_guard
  BEFORE INSERT OR UPDATE ON public.workflow_triggers
  FOR EACH ROW EXECUTE FUNCTION public.assert_owner_for_privileged_trigger();

-- ============================================================================
-- Hasura roles owner/editor/viewer must be *requestable* by every user, because
-- which one applies depends on the org being addressed, not on the account.
-- Granting them here keeps the app self-contained instead of depending on the
-- nhost dashboard's "default allowed roles" setting. This is safe: the role is
-- only a scope selector — every permission still re-checks org_members.
-- ============================================================================
INSERT INTO auth.roles (role) VALUES ('owner'), ('editor'), ('viewer')
  ON CONFLICT (role) DO NOTHING;

CREATE OR REPLACE FUNCTION public.grant_workflow_roles(target_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO auth.user_roles (user_id, role)
  VALUES (target_user, 'owner'), (target_user, 'editor'), (target_user, 'viewer')
  ON CONFLICT DO NOTHING;
END;
$$;

-- Hung off org_members rather than auth.users: nobody can use the app without a
-- membership row, and auth.users is owned by nhost's auth role, so a trigger
-- there would not be droppable on the next migration.
CREATE OR REPLACE FUNCTION public.grant_roles_on_membership()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM public.grant_workflow_roles(NEW.user_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER org_members_grant_roles
  AFTER INSERT ON public.org_members
  FOR EACH ROW EXECUTE FUNCTION public.grant_roles_on_membership();

INSERT INTO auth.user_roles (user_id, role)
SELECT u.id, r.role
FROM auth.users u
CROSS JOIN (VALUES ('owner'), ('editor'), ('viewer')) AS r(role)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Whoever creates an organization becomes its first owner. Without this the
-- creator would immediately lose access to the row their own permissions
-- require an org_members entry for.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bootstrap_org_owner()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  actor uuid := nullif(current_setting('hasura.user', true)::json ->> 'x-hasura-user-id', '')::uuid;
BEGIN
  IF actor IS NOT NULL THEN
    INSERT INTO public.org_members (org_id, user_id, role)
    VALUES (NEW.id, actor, 'owner')
    ON CONFLICT (org_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER organizations_bootstrap_owner
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.bootstrap_org_owner();

-- ============================================================================
-- Quota helpers (called by the Action handler with the admin role)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.roll_quota_period(target_org uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.organizations
     SET quota_used = 0,
         quota_period_start = date_trunc('month', now())::date
   WHERE id = target_org
     AND quota_period_start < date_trunc('month', now())::date;
END;
$$;

-- Output columns are deliberately not named quota_used/quota_limit: inside
-- plpgsql those would be ambiguous against the organizations columns.
CREATE OR REPLACE FUNCTION public.consume_org_quota(target_org uuid, amount integer DEFAULT 1)
RETURNS TABLE (allowed boolean, used integer, max_allowed integer)
LANGUAGE plpgsql AS $$
DECLARE
  cur_used  integer;
  cur_limit integer;
BEGIN
  PERFORM public.roll_quota_period(target_org);

  SELECT o.quota_used, o.quota_limit
    INTO cur_used, cur_limit
    FROM public.organizations o
   WHERE o.id = target_org
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, 0;
    RETURN;
  END IF;

  IF cur_used + amount > cur_limit THEN
    RETURN QUERY SELECT false, cur_used, cur_limit;
    RETURN;
  END IF;

  UPDATE public.organizations o
     SET quota_used = o.quota_used + amount
   WHERE o.id = target_org
   RETURNING o.quota_used INTO cur_used;

  RETURN QUERY SELECT true, cur_used, cur_limit;
END;
$$;
