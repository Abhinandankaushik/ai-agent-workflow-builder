import 'server-only';

export type RunContext = {
  run: { id: string; input: unknown };
  steps: Record<string, { output: unknown }>;
  prev: { output: unknown } | null;
};

const WHOLE = /^\{\{\s*([^}]+?)\s*\}\}$/;
const INLINE = /\{\{\s*([^}]+?)\s*\}\}/g;

function walk(root: unknown, parts: string[]): unknown {
  return parts.reduce<unknown>((acc, part) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc)) return acc[Number(part)];
    if (typeof acc === 'object') return (acc as Record<string, unknown>)[part];
    return undefined;
  }, root);
}

/**
 * Step names are user-supplied and routinely contain dots and spaces, so a
 * `steps.<name>.<path>` reference is resolved by matching the longest known
 * step name rather than by naive dot splitting.
 */
export function resolvePath(ctx: RunContext, path: string): unknown {
  const parts = path.split('.').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return undefined;

  if (parts[0] === 'steps') {
    const names = Object.keys(ctx.steps);
    for (let len = parts.length - 1; len >= 1; len--) {
      const candidate = parts.slice(1, 1 + len).join('.');
      if (names.includes(candidate)) return walk(ctx.steps[candidate], parts.slice(1 + len));
    }
    return undefined;
  }
  return walk(ctx as unknown as Record<string, unknown>, parts);
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function render<T>(value: T, ctx: RunContext): T {
  if (typeof value === 'string') {
    const whole = value.match(WHOLE);
    // a template that is exactly one expression keeps the resolved value's type
    if (whole) return resolvePath(ctx, whole[1]) as T;
    return value.replace(INLINE, (_, path) => stringify(resolvePath(ctx, path))) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((item) => render(item, ctx)) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, render(v, ctx)]),
    ) as unknown as T;
  }
  return value;
}
