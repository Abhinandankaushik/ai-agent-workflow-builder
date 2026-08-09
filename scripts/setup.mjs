// Applies the SQL migration and merges this project's Hasura metadata into
// whatever nhost already has tracked (auth + storage), then writes the merged
// result to hasura/metadata.json as a repo deliverable.
//
//   node scripts/setup.mjs              -> drop + recreate schema, apply metadata
//   node scripts/setup.mjs --metadata   -> metadata only, leave data alone

import { loadEnv, hasuraPost, runSql, readFile, writeFile } from './lib.mjs';
import {
  buildTables,
  buildActions,
  buildCustomTypes,
  buildCronTriggers,
  authUsersAdditions,
  PROJECT_TABLE_NAMES,
} from './metadata.mjs';

const env = loadEnv();
const metadataOnly = process.argv.includes('--metadata');

const MIGRATION_DIR = 'hasura/migrations/default/1700000000000_init';

async function applySql() {
  console.log('› dropping previous schema (down.sql)');
  // cascade so Hasura also drops the metadata objects that depend on these
  // tables; applyMetadata() puts them back immediately afterwards.
  await runSql(env, readFile(`${MIGRATION_DIR}/down.sql`), true);
  console.log('› creating schema (up.sql)');
  await runSql(env, readFile(`${MIGRATION_DIR}/up.sql`));
  console.log('  schema ok');
}

function mergeMetadata(current) {
  const meta = structuredClone(current);
  meta.version = 3;

  const source = (meta.sources || []).find((s) => s.name === 'default');
  if (!source) throw new Error('No "default" source found in Hasura metadata.');
  source.tables = source.tables || [];

  // drop our tables so re-running is idempotent, keep nhost's auth/storage ones
  source.tables = source.tables.filter(
    (t) => !(t.table.schema === 'public' && PROJECT_TABLE_NAMES.includes(t.table.name)),
  );
  source.tables.push(...buildTables(env));

  // additive merge into nhost's auth.users entry
  const additions = authUsersAdditions();
  let users = source.tables.find((t) => t.table.schema === 'auth' && t.table.name === 'users');
  if (!users) {
    users = { table: { schema: 'auth', name: 'users' } };
    source.tables.push(users);
  }
  users.array_relationships = [
    ...(users.array_relationships || []).filter((r) => r.name !== 'orgMemberships'),
    ...additions.array_relationships,
  ];
  users.select_permissions = [
    ...(users.select_permissions || []).filter(
      (p) => !additions.select_permissions.some((n) => n.role === p.role),
    ),
    ...additions.select_permissions,
  ];

  const ours = buildActions(env);
  const ourNames = new Set(ours.map((a) => a.name));
  meta.actions = [...(meta.actions || []).filter((a) => !ourNames.has(a.name)), ...ours];

  const custom = buildCustomTypes();
  const existing = meta.custom_types || {};
  const objNames = new Set(custom.objects.map((o) => o.name));
  meta.custom_types = {
    enums: existing.enums || [],
    input_objects: existing.input_objects || [],
    scalars: existing.scalars || [],
    objects: [...(existing.objects || []).filter((o) => !objNames.has(o.name)), ...custom.objects],
  };

  const crons = buildCronTriggers(env);
  const cronNames = new Set(crons.map((c) => c.name));
  meta.cron_triggers = [
    ...(meta.cron_triggers || []).filter((c) => !cronNames.has(c.name)),
    ...crons,
  ];

  return meta;
}

async function applyMetadata() {
  console.log('› exporting current metadata');
  const current = await hasuraPost(env, '/v1/metadata', { type: 'export_metadata', args: {} });
  const merged = mergeMetadata(current);

  console.log('› replacing metadata');
  await hasuraPost(env, '/v1/metadata', {
    type: 'replace_metadata',
    args: { allow_inconsistent_metadata: false, metadata: merged },
  });

  const inconsistent = await hasuraPost(env, '/v1/metadata', {
    type: 'get_inconsistent_metadata',
    args: {},
  });
  if (inconsistent.is_consistent === false) {
    console.error(JSON.stringify(inconsistent.inconsistent_objects, null, 2));
    throw new Error('Metadata applied but is inconsistent.');
  }

  // The live metadata carries ACTION_SECRET as a literal header value; the
  // committed snapshot must not.
  const snapshot = JSON.parse(
    JSON.stringify(merged).split(JSON.stringify(env.actionSecret).slice(1, -1)).join('${ACTION_SECRET}'),
  );
  writeFile('hasura/metadata.json', JSON.stringify(snapshot, null, 2));
  console.log('  metadata ok (snapshot written to hasura/metadata.json)');
}

// keeps the Next.js app's env in sync with the one the scripts already read
function syncWebEnv() {
  const lines = [
    `NEXT_PUBLIC_NHOST_SUBDOMAIN=${env.subdomain}`,
    `NEXT_PUBLIC_NHOST_REGION=${env.region}`,
    `NHOST_SUBDOMAIN=${env.subdomain}`,
    `NHOST_REGION=${env.region}`,
    `HASURA_ADMIN_SECRET=${env.adminSecret}`,
    `ACTION_SECRET=${env.actionSecret}`,
    `GROQ_API_KEY=${process.env.GROQ_API_KEY ?? ''}`,
    `GROQ_MODEL=${process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile'}`,
    `SLACK_WEBHOOK_URL=${process.env.SLACK_WEBHOOK_URL ?? ''}`,
  ];
  writeFile('web/.env.local', `${lines.join('\n')}\n`);
  console.log('  wrote web/.env.local');
}

(async () => {
  console.log(`\nHasura: ${env.hasuraUrl}`);
  console.log(`Handlers: ${env.handlerBaseUrl}\n`);
  if (!metadataOnly) await applySql();
  await applyMetadata();
  syncWebEnv();
  console.log('\nDone.\n');
})().catch((err) => {
  console.error('\nSetup failed:\n', err.message);
  process.exit(1);
});
