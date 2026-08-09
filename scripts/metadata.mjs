// Single source of truth for the Hasura metadata this project owns.
// setup.mjs exports the live metadata, merges this in (so nhost's auth/storage
// metadata survives), and calls replace_metadata.

const ROLES = ['owner', 'editor', 'viewer'];
const WRITE_ROLES = ['owner', 'editor'];

const me = { _eq: 'X-Hasura-User-Id' };

// Layer 1 --------------------------------------------------------------------
// Every permission is (a) scoped to the caller's own org via org_members and
// (b) scoped to the role they actually hold in THAT org. Holding `editor` in
// Org A never grants anything in Org B, even with the same JWT role claim.
const memberPredicate = (role) => ({
  user_id: me,
  ...(role ? { role: { _eq: role } } : {}),
});

const viaOrganization = (role) => ({ organization: { members: memberPredicate(role) } });
const viaWorkflow = (role) => ({ workflow: { organization: { members: memberPredicate(role) } } });
const viaRun = (role) => ({ run: { organization: { members: memberPredicate(role) } } });
const onOrganization = (role) => ({ members: memberPredicate(role) });

const table = (name, schema = 'public') => ({ name, schema });

const arrayRel = (name, remoteTable, column) => ({
  name,
  using: { foreign_key_constraint_on: { column, table: table(remoteTable) } },
});

const objectRel = (name, column) => ({
  name,
  using: { foreign_key_constraint_on: column },
});

const manualObjectRel = (name, remoteTable, columnMapping, schema = 'public') => ({
  name,
  using: {
    manual_configuration: {
      remote_table: table(remoteTable, schema),
      column_mapping: columnMapping,
      insertion_order: null,
    },
  },
});

const selectFor = (roles, columns, filterFor, extra = {}) =>
  roles.map((role) => ({
    role,
    permission: {
      columns,
      filter: filterFor(role),
      allow_aggregations: true,
      ...extra,
    },
  }));

// ---------------------------------------------------------------------------

const COLS = {
  organizations: ['id', 'name', 'slug', 'quota_limit', 'quota_used', 'quota_period_start', 'created_at', 'updated_at'],
  org_members: ['id', 'org_id', 'user_id', 'role', 'created_at', 'updated_at'],
  workflows: ['id', 'org_id', 'name', 'description', 'is_active', 'created_by', 'created_at', 'updated_at'],
  workflow_steps: ['id', 'workflow_id', 'name', 'type', 'position', 'config', 'created_by', 'created_at', 'updated_at'],
  workflow_triggers_public: ['id', 'workflow_id', 'type', 'config', 'cron', 'last_fired_at', 'is_active', 'created_by', 'created_at', 'updated_at'],
  workflow_triggers_owner: ['id', 'workflow_id', 'type', 'config', 'webhook_secret', 'cron', 'last_fired_at', 'is_active', 'created_by', 'created_at', 'updated_at'],
  workflow_runs: ['id', 'workflow_id', 'org_id', 'status', 'trigger_type', 'trigger_id', 'triggered_by', 'cursor', 'input', 'output', 'error', 'started_at', 'finished_at', 'created_at', 'updated_at'],
  step_runs: ['id', 'workflow_run_id', 'step_id', 'org_id', 'name', 'type', 'position', 'status', 'input', 'output', 'error', 'attempt_count', 'approved_by', 'approved_at', 'approval_note', 'started_at', 'finished_at', 'created_at', 'updated_at'],
  workflow_artifacts: ['id', 'org_id', 'workflow_run_id', 'step_run_id', 'key', 'payload', 'created_at'],
  notifications: ['id', 'org_id', 'workflow_run_id', 'step_run_id', 'channel', 'target', 'message', 'status', 'error', 'delivered_at', 'created_at', 'updated_at'],
  watched_events: ['id', 'org_id', 'source', 'payload', 'created_by', 'created_at'],
  org_usage: ['org_id', 'org_name', 'quota_limit', 'quota_used', 'quota_remaining', 'quota_period_start', 'runs_this_period', 'completed_runs', 'failed_runs', 'paused_runs', 'avg_run_seconds', 'llm_calls_this_period', 'external_calls_this_period'],
};

// Layer 2 --------------------------------------------------------------------
// Privileged step / trigger types reach outside the sandbox, so an editor is
// blocked from ever creating them. Enforced here at the row level AND again by
// a Postgres BEFORE trigger (see the migration) AND re-checked in the engine.
const PRIVILEGED_STEP_TYPES = ['db_write', 'notify'];
const PRIVILEGED_TRIGGER_TYPES = ['webhook'];

export function buildTables({ handlerBaseUrl, actionSecret }) {
  const eventHeaders = [{ name: 'x-action-secret', value: actionSecret }];
  const retryConf = { num_retries: 3, interval_sec: 10, timeout_sec: 60 };

  return [
    // -------------------------------------------------------- organizations
    {
      table: table('organizations'),
      array_relationships: [
        arrayRel('members', 'org_members', 'org_id'),
        arrayRel('workflows', 'workflows', 'org_id'),
        arrayRel('runs', 'workflow_runs', 'org_id'),
      ],
      object_relationships: [manualObjectRel('usage', 'org_usage', { id: 'org_id' })],
      insert_permissions: [
        { role: 'user', permission: { check: {}, columns: ['name', 'slug'] } },
      ],
      select_permissions: [
        {
          role: 'user',
          permission: { columns: COLS.organizations, filter: onOrganization(null), allow_aggregations: true },
        },
        ...selectFor(ROLES, COLS.organizations, onOrganization),
      ],
      update_permissions: [
        {
          role: 'owner',
          permission: {
            columns: ['name', 'quota_limit'],
            filter: onOrganization('owner'),
            check: onOrganization('owner'),
          },
        },
      ],
      delete_permissions: [
        { role: 'owner', permission: { filter: onOrganization('owner') } },
      ],
    },

    // ---------------------------------------------------------- org_members
    {
      table: table('org_members'),
      object_relationships: [objectRel('organization', 'org_id'), objectRel('user', 'user_id')],
      insert_permissions: [
        {
          role: 'owner',
          permission: { check: viaOrganization('owner'), columns: ['org_id', 'user_id', 'role'] },
        },
      ],
      select_permissions: [
        {
          role: 'user',
          permission: { columns: COLS.org_members, filter: { user_id: me }, allow_aggregations: true },
        },
        ...selectFor(ROLES, COLS.org_members, viaOrganization),
      ],
      update_permissions: [
        {
          role: 'owner',
          permission: {
            columns: ['role'],
            filter: viaOrganization('owner'),
            check: viaOrganization('owner'),
          },
        },
      ],
      delete_permissions: [
        { role: 'owner', permission: { filter: viaOrganization('owner') } },
      ],
    },

    // ------------------------------------------------------------ workflows
    {
      table: table('workflows'),
      object_relationships: [objectRel('organization', 'org_id'), objectRel('creator', 'created_by')],
      array_relationships: [
        arrayRel('steps', 'workflow_steps', 'workflow_id'),
        arrayRel('triggers', 'workflow_triggers', 'workflow_id'),
        arrayRel('runs', 'workflow_runs', 'workflow_id'),
      ],
      computed_fields: [
        {
          name: 'latest_run_status',
          definition: { function: table('workflow_latest_run_status') },
          comment: 'status of the most recent workflow_run',
        },
        {
          name: 'run_count',
          definition: { function: table('workflow_run_count') },
        },
      ],
      insert_permissions: WRITE_ROLES.map((role) => ({
        role,
        permission: {
          check: viaOrganization(role),
          columns: ['org_id', 'name', 'description', 'is_active'],
          set: { created_by: 'x-hasura-User-Id' },
        },
      })),
      select_permissions: selectFor(ROLES, COLS.workflows, viaOrganization, {
        computed_fields: ['latest_run_status', 'run_count'],
      }),
      update_permissions: WRITE_ROLES.map((role) => ({
        role,
        permission: {
          columns: ['name', 'description', 'is_active'],
          filter: viaOrganization(role),
          check: viaOrganization(role),
        },
      })),
      delete_permissions: [{ role: 'owner', permission: { filter: viaOrganization('owner') } }],
    },

    // ------------------------------------------------------- workflow_steps
    {
      table: table('workflow_steps'),
      object_relationships: [objectRel('workflow', 'workflow_id')],
      array_relationships: [arrayRel('step_runs', 'step_runs', 'step_id')],
      insert_permissions: [
        {
          role: 'owner',
          permission: {
            check: viaWorkflow('owner'),
            columns: ['workflow_id', 'name', 'type', 'position', 'config'],
            set: { created_by: 'x-hasura-User-Id' },
          },
        },
        {
          // Layer 2: an editor may never introduce a db_write or notify step.
          role: 'editor',
          permission: {
            check: { _and: [viaWorkflow('editor'), { type: { _nin: PRIVILEGED_STEP_TYPES } }] },
            columns: ['workflow_id', 'name', 'type', 'position', 'config'],
            set: { created_by: 'x-hasura-User-Id' },
          },
        },
      ],
      select_permissions: selectFor(ROLES, COLS.workflow_steps, viaWorkflow),
      update_permissions: [
        {
          role: 'owner',
          permission: {
            columns: ['name', 'type', 'position', 'config'],
            filter: viaWorkflow('owner'),
            check: viaWorkflow('owner'),
          },
        },
        {
          role: 'editor',
          permission: {
            columns: ['name', 'type', 'position', 'config'],
            filter: { _and: [viaWorkflow('editor'), { type: { _nin: PRIVILEGED_STEP_TYPES } }] },
            check: { _and: [viaWorkflow('editor'), { type: { _nin: PRIVILEGED_STEP_TYPES } }] },
          },
        },
      ],
      delete_permissions: [
        { role: 'owner', permission: { filter: viaWorkflow('owner') } },
        {
          role: 'editor',
          permission: { filter: { _and: [viaWorkflow('editor'), { type: { _nin: PRIVILEGED_STEP_TYPES } }] } },
        },
      ],
    },

    // ---------------------------------------------------- workflow_triggers
    {
      table: table('workflow_triggers'),
      object_relationships: [objectRel('workflow', 'workflow_id')],
      insert_permissions: [
        {
          role: 'owner',
          permission: {
            check: viaWorkflow('owner'),
            columns: ['workflow_id', 'type', 'config', 'cron', 'is_active'],
            set: { created_by: 'x-hasura-User-Id' },
          },
        },
        {
          // Layer 2: webhook triggers are an inbound public entry point -> owner only.
          role: 'editor',
          permission: {
            check: { _and: [viaWorkflow('editor'), { type: { _nin: PRIVILEGED_TRIGGER_TYPES } }] },
            columns: ['workflow_id', 'type', 'config', 'cron', 'is_active'],
            set: { created_by: 'x-hasura-User-Id' },
          },
        },
      ],
      select_permissions: [
        // only an owner may read the webhook secret
        {
          role: 'owner',
          permission: { columns: COLS.workflow_triggers_owner, filter: viaWorkflow('owner'), allow_aggregations: true },
        },
        ...selectFor(['editor', 'viewer'], COLS.workflow_triggers_public, viaWorkflow),
      ],
      update_permissions: [
        {
          role: 'owner',
          permission: {
            columns: ['type', 'config', 'cron', 'is_active'],
            filter: viaWorkflow('owner'),
            check: viaWorkflow('owner'),
          },
        },
        {
          role: 'editor',
          permission: {
            columns: ['config', 'cron', 'is_active'],
            filter: { _and: [viaWorkflow('editor'), { type: { _nin: PRIVILEGED_TRIGGER_TYPES } }] },
            check: { _and: [viaWorkflow('editor'), { type: { _nin: PRIVILEGED_TRIGGER_TYPES } }] },
          },
        },
      ],
      delete_permissions: [
        { role: 'owner', permission: { filter: viaWorkflow('owner') } },
        {
          role: 'editor',
          permission: { filter: { _and: [viaWorkflow('editor'), { type: { _nin: PRIVILEGED_TRIGGER_TYPES } }] } },
        },
      ],
    },

    // -------------------------------------------------------- workflow_runs
    // No client-side insert/update at all: runs may only be created and mutated
    // by the Action handler (admin role). That is what makes "viewer cannot
    // trigger a run" absolute rather than a UI convention.
    {
      table: table('workflow_runs'),
      object_relationships: [
        objectRel('workflow', 'workflow_id'),
        objectRel('organization', 'org_id'),
        objectRel('trigger', 'trigger_id'),
        objectRel('initiator', 'triggered_by'),
      ],
      array_relationships: [arrayRel('step_runs', 'step_runs', 'workflow_run_id')],
      select_permissions: selectFor(ROLES, COLS.workflow_runs, viaOrganization),
    },

    // ------------------------------------------------------------ step_runs
    {
      table: table('step_runs'),
      object_relationships: [
        manualObjectRel('run', 'workflow_runs', { workflow_run_id: 'id' }),
        objectRel('step', 'step_id'),
        objectRel('organization', 'org_id'),
        objectRel('approver', 'approved_by'),
      ],
      select_permissions: selectFor(ROLES, COLS.step_runs, viaOrganization),
    },

    // --------------------------------------------------- workflow_artifacts
    {
      table: table('workflow_artifacts'),
      object_relationships: [
        objectRel('organization', 'org_id'),
        manualObjectRel('run', 'workflow_runs', { workflow_run_id: 'id' }),
      ],
      select_permissions: selectFor(ROLES, COLS.workflow_artifacts, viaOrganization),
    },

    // -------------------------------------------------------- notifications
    {
      table: table('notifications'),
      object_relationships: [objectRel('organization', 'org_id')],
      select_permissions: selectFor(ROLES, COLS.notifications, viaOrganization),
      event_triggers: [
        {
          name: 'notify_dispatch',
          definition: { enable_manual: true, insert: { columns: '*' } },
          retry_conf: retryConf,
          webhook: `${handlerBaseUrl}/api/events/notify`,
          headers: eventHeaders,
        },
      ],
    },

    // ------------------------------------------------------- watched_events
    {
      table: table('watched_events'),
      object_relationships: [objectRel('organization', 'org_id')],
      insert_permissions: WRITE_ROLES.map((role) => ({
        role,
        permission: {
          check: viaOrganization(role),
          columns: ['org_id', 'source', 'payload'],
          set: { created_by: 'x-hasura-User-Id' },
        },
      })),
      select_permissions: selectFor(ROLES, COLS.watched_events, viaOrganization),
      event_triggers: [
        {
          name: 'watched_row_inserted',
          definition: { enable_manual: true, insert: { columns: '*' } },
          retry_conf: retryConf,
          webhook: `${handlerBaseUrl}/api/events/watched-row`,
          headers: eventHeaders,
        },
      ],
    },

    // ------------------------------------------------- org_usage (view/aggregation)
    {
      table: table('org_usage'),
      object_relationships: [manualObjectRel('organization', 'organizations', { org_id: 'id' })],
      select_permissions: selectFor(ROLES, COLS.org_usage, viaOrganization),
    },
  ];
}

export function buildCustomTypes() {
  return {
    enums: [],
    input_objects: [],
    objects: [
      {
        name: 'TriggerWorkflowRunOutput',
        fields: [
          { name: 'run_id', type: 'uuid!' },
          { name: 'status', type: 'String!' },
          { name: 'message', type: 'String' },
        ],
      },
      {
        name: 'ApproveStepOutput',
        fields: [
          { name: 'step_run_id', type: 'uuid!' },
          { name: 'run_status', type: 'String!' },
          { name: 'approved', type: 'Boolean!' },
          { name: 'message', type: 'String' },
        ],
      },
      {
        name: 'InviteMemberOutput',
        fields: [
          { name: 'org_member_id', type: 'uuid!' },
          { name: 'user_id', type: 'uuid!' },
          { name: 'message', type: 'String' },
        ],
      },
    ],
    scalars: [],
  };
}

export function buildActions({ handlerBaseUrl, actionSecret }) {
  const headers = [{ name: 'x-action-secret', value: actionSecret }];
  const base = {
    kind: 'synchronous',
    type: 'mutation',
    forward_client_headers: true,
    headers,
    timeout: 120,
  };

  return [
    {
      name: 'triggerWorkflowRun',
      definition: {
        ...base,
        handler: `${handlerBaseUrl}/api/actions/trigger-workflow-run`,
        output_type: 'TriggerWorkflowRunOutput!',
        arguments: [
          { name: 'workflow_id', type: 'uuid!' },
          { name: 'input', type: 'jsonb' },
        ],
      },
      // viewer is deliberately absent: a viewer can never start a run.
      permissions: WRITE_ROLES.map((role) => ({ role })),
      comment: 'Starts a workflow run after re-verifying org membership + quota server side.',
    },
    {
      name: 'approveStep',
      definition: {
        ...base,
        handler: `${handlerBaseUrl}/api/actions/approve-step`,
        output_type: 'ApproveStepOutput!',
        arguments: [
          { name: 'step_run_id', type: 'uuid!' },
          { name: 'decision', type: 'String' },
          { name: 'note', type: 'String' },
        ],
      },
      permissions: WRITE_ROLES.map((role) => ({ role })),
      comment: 'Clears a paused approval_gate. The handler re-checks the approver role.',
    },
    {
      name: 'inviteMember',
      definition: {
        ...base,
        handler: `${handlerBaseUrl}/api/actions/invite-member`,
        output_type: 'InviteMemberOutput!',
        arguments: [
          { name: 'org_id', type: 'uuid!' },
          { name: 'email', type: 'String!' },
          { name: 'role', type: 'String!' },
        ],
      },
      permissions: [{ role: 'owner' }],
      comment: 'Owner-only: add an existing nhost user to the org with a role.',
    },
    {
      name: 'triggerWorkflowWebhook',
      definition: {
        ...base,
        handler: `${handlerBaseUrl}/api/actions/webhook-trigger`,
        output_type: 'TriggerWorkflowRunOutput!',
        arguments: [
          { name: 'trigger_id', type: 'uuid!' },
          { name: 'secret', type: 'String!' },
          { name: 'payload', type: 'jsonb' },
        ],
      },
      // Inbound endpoint for external systems: unauthenticated, but the
      // per-trigger secret is verified inside the handler.
      permissions: [{ role: 'public' }, { role: 'user' }, ...ROLES.map((role) => ({ role }))],
      comment: 'Inbound webhook endpoint external systems POST to in order to start a run.',
    },
  ];
}

export function buildCronTriggers({ handlerBaseUrl, actionSecret }) {
  return [
    {
      name: 'workflow_scheduler',
      webhook: `${handlerBaseUrl}/api/cron/scheduler`,
      schedule: '* * * * *',
      include_in_metadata: true,
      payload: {},
      headers: [{ name: 'x-action-secret', value: actionSecret }],
      retry_conf: {
        num_retry_attempts: 1,
        retry_interval_seconds: 10,
        timeout_seconds: 60,
        tolerance_seconds: 21600,
      },
      comment: 'Fires every minute; the handler decides which scheduled triggers are due.',
    },
  ];
}

// nhost already tracks auth.users. We only *add* to it: a reverse relationship
// plus a select permission letting org peers see each other's email.
export function authUsersAdditions() {
  const sharesAnOrgWithMe = {
    _or: [
      { id: me },
      { orgMemberships: { organization: { members: { user_id: me } } } },
    ],
  };
  return {
    array_relationships: [arrayRel('orgMemberships', 'org_members', 'user_id')],
    select_permissions: ROLES.map((role) => ({
      role,
      permission: {
        // permissions use the physical column names; nhost's column_config
        // exposes them as displayName / avatarUrl / createdAt in GraphQL
        columns: ['id', 'display_name', 'email', 'avatar_url', 'created_at'],
        filter: sharesAnOrgWithMe,
        allow_aggregations: false,
      },
    })),
  };
}

export const PROJECT_TABLE_NAMES = [
  'organizations',
  'org_members',
  'workflows',
  'workflow_steps',
  'workflow_triggers',
  'workflow_runs',
  'step_runs',
  'workflow_artifacts',
  'notifications',
  'watched_events',
  'org_usage',
];
