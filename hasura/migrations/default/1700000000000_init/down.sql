DROP TRIGGER IF EXISTS org_members_grant_roles ON public.org_members;
DROP FUNCTION IF EXISTS public.grant_roles_on_membership();
DROP FUNCTION IF EXISTS public.grant_workflow_roles(uuid);
DROP TRIGGER IF EXISTS organizations_bootstrap_owner ON public.organizations;
DROP TRIGGER IF EXISTS workflow_triggers_privileged_guard ON public.workflow_triggers;
DROP TRIGGER IF EXISTS workflow_steps_privileged_guard ON public.workflow_steps;

DROP FUNCTION IF EXISTS public.consume_org_quota(uuid, integer) CASCADE;
DROP FUNCTION IF EXISTS public.roll_quota_period(uuid);
DROP FUNCTION IF EXISTS public.bootstrap_org_owner();
DROP FUNCTION IF EXISTS public.assert_owner_for_privileged_trigger();
DROP FUNCTION IF EXISTS public.assert_owner_for_privileged_step();
DROP FUNCTION IF EXISTS public.workflow_run_count(public.workflows);
DROP FUNCTION IF EXISTS public.workflow_latest_run_status(public.workflows);

DROP VIEW IF EXISTS public.org_usage;

DROP TABLE IF EXISTS public.watched_events;
DROP TABLE IF EXISTS public.notifications;
DROP TABLE IF EXISTS public.workflow_artifacts;
DROP TABLE IF EXISTS public.step_runs;
DROP TABLE IF EXISTS public.workflow_runs;
DROP TABLE IF EXISTS public.workflow_triggers;
DROP TABLE IF EXISTS public.workflow_steps;
DROP TABLE IF EXISTS public.workflows;
DROP TABLE IF EXISTS public.org_members;
DROP TABLE IF EXISTS public.organizations;

DROP FUNCTION IF EXISTS public.set_updated_at();
