import 'server-only';
import { serverEnv } from './env';

export async function adminGql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(serverEnv.graphqlUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hasura-admin-secret': serverEnv.adminSecret,
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e: any) => e.message).join('; '));
  return json.data as T;
}

/** Calls a Postgres function through Hasura's SQL endpoint (admin only). */
export async function adminSql<T = any>(sql: string, args: unknown[] = []): Promise<T[]> {
  const res = await fetch(`${serverEnv.hasuraUrl}/v2/query`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hasura-admin-secret': serverEnv.adminSecret,
    },
    body: JSON.stringify({
      type: 'run_sql',
      args: { source: 'default', sql: interpolate(sql, args), read_only: false },
    }),
    cache: 'no-store',
  });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(JSON.stringify(json).slice(0, 500));
  const [header, ...rows] = json.result as string[][];
  return rows.map((row) => Object.fromEntries(row.map((v, i) => [header[i], v]))) as T[];
}

function interpolate(sql: string, args: unknown[]): string {
  return sql.replace(/\$(\d+)/g, (_, n) => literal(args[Number(n) - 1]));
}

function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return `'${String(value).replace(/'/g, "''")}'`;
}
