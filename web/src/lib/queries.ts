import { gql } from '@apollo/client';

/** Bootstrap: which orgs am I in, and with what role in each. Runs as role `user`. */
export const MY_MEMBERSHIPS = gql`
  query MyMemberships {
    org_members(order_by: { created_at: asc }) {
      id
      org_id
      role
      organization {
        id
        name
        slug
      }
    }
  }
`;

/** The assignment's headline query: workflows + steps + triggers + latest run status. */
export const ORG_WORKFLOWS = gql`
  query OrgWorkflows($orgId: uuid!) {
    workflows(where: { org_id: { _eq: $orgId } }, order_by: { created_at: desc }) {
      id
      name
      description
      is_active
      created_at
      latest_run_status
      run_count
      steps(order_by: { position: asc }) {
        id
        name
        type
        position
        config
      }
      triggers(order_by: { created_at: asc }) {
        id
        type
        is_active
        cron
        config
        last_fired_at
      }
      runs(order_by: { created_at: desc }, limit: 1) {
        id
        status
        trigger_type
        created_at
        finished_at
      }
    }
  }
`;

export const WORKFLOW_DETAIL = gql`
  query WorkflowDetail($id: uuid!) {
    workflows_by_pk(id: $id) {
      id
      org_id
      name
      description
      is_active
      latest_run_status
      steps(order_by: { position: asc }) {
        id
        name
        type
        position
        config
      }
      triggers(order_by: { created_at: asc }) {
        id
        type
        is_active
        cron
        config
        last_fired_at
      }
    }
  }
`;

/** webhook_secret is column-restricted to owners, so this is a separate document. */
export const WORKFLOW_WEBHOOKS = gql`
  query WorkflowWebhooks($id: uuid!) {
    workflow_triggers(where: { workflow_id: { _eq: $id }, type: { _eq: "webhook" } }) {
      id
      webhook_secret
      is_active
    }
  }
`;

export const ORG_USAGE = gql`
  query OrgUsage($orgId: uuid!) {
    org_usage(where: { org_id: { _eq: $orgId } }) {
      org_id
      org_name
      quota_limit
      quota_used
      quota_remaining
      quota_period_start
      runs_this_period
      completed_runs
      failed_runs
      paused_runs
      avg_run_seconds
      llm_calls_this_period
    }
  }
`;

export const ORG_MEMBERS = gql`
  query OrgMembers($orgId: uuid!) {
    org_members(where: { org_id: { _eq: $orgId } }, order_by: { created_at: asc }) {
      id
      role
      user_id
      user {
        id
        displayName
        email
      }
    }
  }
`;

export const WORKFLOW_RUNS = gql`
  query WorkflowRuns($workflowId: uuid!) {
    workflow_runs(
      where: { workflow_id: { _eq: $workflowId } }
      order_by: { created_at: desc }
      limit: 25
    ) {
      id
      status
      trigger_type
      created_at
      started_at
      finished_at
      error
      initiator {
        id
        displayName
        email
      }
    }
  }
`;

/** Org-wide run feed. A subscription so webhook / cron / DB-event runs appear unprompted. */
export const ORG_RUNS_LIVE = gql`
  subscription OrgRunsLive($orgId: uuid!) {
    workflow_runs(where: { org_id: { _eq: $orgId } }, order_by: { created_at: desc }, limit: 40) {
      id
      status
      trigger_type
      created_at
      started_at
      finished_at
      error
      workflow {
        id
        name
      }
      initiator {
        id
        displayName
        email
      }
      step_runs(order_by: { position: asc }) {
        id
        status
        type
      }
    }
  }
`;

/** Required subscription: live per-step progress for one run, including the paused state. */
export const STEP_RUNS_LIVE = gql`
  subscription StepRunsLive($runId: uuid!) {
    step_runs(where: { workflow_run_id: { _eq: $runId } }, order_by: { position: asc }) {
      id
      name
      type
      position
      status
      attempt_count
      error
      output
      approved_at
      approval_note
      started_at
      finished_at
      approver {
        id
        displayName
        email
      }
    }
  }
`;

export const RUN_LIVE = gql`
  subscription RunLive($runId: uuid!) {
    workflow_runs_by_pk(id: $runId) {
      id
      org_id
      status
      error
      input
      output
      trigger_type
      started_at
      finished_at
      workflow {
        id
        name
      }
    }
  }
`;

export const RUN_SIDE_EFFECTS = gql`
  query RunSideEffects($runId: uuid!) {
    workflow_artifacts(where: { workflow_run_id: { _eq: $runId } }, order_by: { created_at: asc }) {
      id
      key
      payload
      created_at
    }
    notifications(where: { workflow_run_id: { _eq: $runId } }, order_by: { created_at: asc }) {
      id
      channel
      message
      status
      error
    }
  }
`;

// ------------------------------------------------------------------ mutations

export const CREATE_ORG = gql`
  mutation CreateOrg($name: String!, $slug: String!) {
    insert_organizations_one(object: { name: $name, slug: $slug }) {
      id
      name
      slug
    }
  }
`;

export const CREATE_WORKFLOW = gql`
  mutation CreateWorkflow($orgId: uuid!, $name: String!, $description: String!) {
    insert_workflows_one(object: { org_id: $orgId, name: $name, description: $description }) {
      id
      name
    }
  }
`;

/**
 * Create/edit a workflow, its steps and its triggers in one round trip.
 * Steps are replaced wholesale; step_runs keep a denormalised copy of name/type
 * so run history survives an edit.
 */
export const SAVE_WORKFLOW = gql`
  mutation SaveWorkflow(
    $id: uuid!
    $name: String!
    $description: String!
    $isActive: Boolean!
    $steps: [workflow_steps_insert_input!]!
  ) {
    update_workflows_by_pk(
      pk_columns: { id: $id }
      _set: { name: $name, description: $description, is_active: $isActive }
    ) {
      id
    }
    delete_workflow_steps(where: { workflow_id: { _eq: $id } }) {
      affected_rows
    }
    insert_workflow_steps(objects: $steps) {
      affected_rows
      returning {
        id
        name
        type
        position
        config
      }
    }
  }
`;

export const ADD_TRIGGER = gql`
  mutation AddTrigger($object: workflow_triggers_insert_input!) {
    insert_workflow_triggers_one(object: $object) {
      id
      type
    }
  }
`;

export const DELETE_TRIGGER = gql`
  mutation DeleteTrigger($id: uuid!) {
    delete_workflow_triggers_by_pk(id: $id) {
      id
    }
  }
`;

export const DELETE_WORKFLOW = gql`
  mutation DeleteWorkflow($id: uuid!) {
    delete_workflows_by_pk(id: $id) {
      id
    }
  }
`;

export const INSERT_WATCHED_EVENT = gql`
  mutation InsertWatchedEvent($orgId: uuid!, $source: String!, $payload: jsonb!) {
    insert_watched_events_one(object: { org_id: $orgId, source: $source, payload: $payload }) {
      id
    }
  }
`;

export const UPDATE_MEMBER_ROLE = gql`
  mutation UpdateMemberRole($id: uuid!, $role: String!) {
    update_org_members_by_pk(pk_columns: { id: $id }, _set: { role: $role }) {
      id
      role
    }
  }
`;

export const REMOVE_MEMBER = gql`
  mutation RemoveMember($id: uuid!) {
    delete_org_members_by_pk(id: $id) {
      id
    }
  }
`;

// -------------------------------------------------------------------- actions

export const TRIGGER_WORKFLOW_RUN = gql`
  mutation TriggerWorkflowRun($workflowId: uuid!, $input: jsonb) {
    triggerWorkflowRun(workflow_id: $workflowId, input: $input) {
      run_id
      status
      message
    }
  }
`;

export const APPROVE_STEP = gql`
  mutation ApproveStep($stepRunId: uuid!, $decision: String, $note: String) {
    approveStep(step_run_id: $stepRunId, decision: $decision, note: $note) {
      step_run_id
      run_status
      approved
      message
    }
  }
`;

export const INVITE_MEMBER = gql`
  mutation InviteMember($orgId: uuid!, $email: String!, $role: String!) {
    inviteMember(org_id: $orgId, email: $email, role: $role) {
      org_member_id
      user_id
      message
    }
  }
`;
