import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv() {
  for (const file of ['.env', '.env.local']) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }

  const subdomain = req('NHOST_SUBDOMAIN');
  const region = req('NHOST_REGION');
  const adminSecret = req('HASURA_ADMIN_SECRET');
  const handlerBaseUrl = (process.env.HANDLER_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const actionSecret = process.env.ACTION_SECRET || 'dev-action-secret';

  return {
    subdomain,
    region,
    adminSecret,
    handlerBaseUrl,
    actionSecret,
    // nhost serves the Hasura admin APIs (/v1/metadata, /v2/query) on the
    // `hasura` host and the GraphQL API on a separate `graphql` host.
    hasuraUrl: `https://${subdomain}.hasura.${region}.nhost.run`,
    graphqlUrl: `https://${subdomain}.graphql.${region}.nhost.run/v1`,
    authUrl: `https://${subdomain}.auth.${region}.nhost.run/v1`,
  };
}

function req(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`\n  Missing required env var ${name}. Copy .env.example to .env and fill it in.\n`);
    process.exit(1);
  }
  return v;
}

export async function hasuraPost(env, endpoint, body) {
  const res = await fetch(`${env.hasuraUrl}${endpoint}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hasura-admin-secret': env.adminSecret,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${endpoint} -> ${res.status}: ${text.slice(0, 500)}`);
  }
  if (!res.ok || json.error || json.code) {
    throw new Error(`${endpoint} -> ${res.status}: ${JSON.stringify(json, null, 2).slice(0, 4000)}`);
  }
  return json;
}

export async function runSql(env, sql, cascade = false) {
  return hasuraPost(env, '/v2/query', {
    type: 'run_sql',
    args: { source: 'default', sql, cascade, read_only: false },
  });
}

export async function adminGraphql(env, query, variables = {}) {
  const res = await fetch(env.graphqlUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hasura-admin-secret': env.adminSecret,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors, null, 2));
  return json.data;
}

export const readFile = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
export const writeFile = (rel, contents) => {
  const target = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
};
