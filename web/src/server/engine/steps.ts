import 'server-only';
import { serverEnv } from '../env';
import { adminGql } from '../admin';
import { render, type RunContext } from './template';

export type StepType =
  | 'llm_call'
  | 'http_request'
  | 'db_write'
  | 'notify'
  | 'conditional_branch'
  | 'approval_gate';

export type StepControl =
  | { action: 'continue' }
  | { action: 'stop' }
  | { action: 'skip_to'; position: number };

export type StepResult = { output: unknown; control?: StepControl };

export type StepExecution = {
  type: StepType;
  name: string;
  config: Record<string, any>;
  orgId: string;
  runId: string;
  stepRunId: string;
  ctx: RunContext;
};

/** Only these reach outside the process, so only these are worth retrying. */
export const RETRYABLE: StepType[] = ['llm_call', 'http_request'];
export const MAX_ATTEMPTS = 2;

export async function executeStep(step: StepExecution): Promise<StepResult> {
  const config = render(step.config ?? {}, step.ctx);
  switch (step.type) {
    case 'llm_call':
      return llmCall(config);
    case 'http_request':
      return httpRequest(config);
    case 'db_write':
      return dbWrite(step, config);
    case 'notify':
      return notify(step, config);
    case 'conditional_branch':
      return conditionalBranch(config);
    case 'approval_gate':
      throw new Error('approval_gate is resolved by the run loop, not executed');
    default:
      throw new Error(`Unknown step type: ${step.type}`);
  }
}

// ---------------------------------------------------------------- llm_call

function stripFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
}

async function llmCall(config: Record<string, any>): Promise<StepResult> {
  const model = config.model || serverEnv.groqModel;
  const messages = [
    ...(config.system ? [{ role: 'system', content: String(config.system) }] : []),
    { role: 'user', content: String(config.prompt ?? '') },
  ];

  let text: string;
  let usage: unknown = null;
  let stubbed = false;

  if (serverEnv.groqApiKey) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${serverEnv.groqApiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: config.temperature ?? 0,
        max_tokens: config.max_tokens ?? 512,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Groq ${res.status}: ${body?.error?.message ?? JSON.stringify(body).slice(0, 200)}`);
    }
    text = body.choices?.[0]?.message?.content ?? '';
    usage = body.usage ?? null;
  } else {
    // No key configured: a disclosed stub with an artificial delay, so the rest
    // of the pipeline (branching, approval, subscriptions) still demonstrates.
    stubbed = true;
    await new Promise((r) => setTimeout(r, 900));
    const prompt = String(config.prompt ?? '').toLowerCase();
    const negative = /(broken|angry|furious|refund|terrible|awful|worst|not work|hate|bug|crash)/.test(prompt);
    text = JSON.stringify({
      sentiment: negative ? 'NEGATIVE' : 'POSITIVE',
      urgency: negative ? 'high' : 'low',
      summary: negative
        ? 'Customer reports a serious problem and is frustrated.'
        : 'Customer is satisfied and shared positive feedback.',
    });
  }

  let json: unknown = null;
  if (config.parse_json !== false) {
    try {
      json = JSON.parse(stripFences(text));
    } catch {
      json = null;
    }
  }

  return { output: { text, json, model, usage, stubbed } };
}

// ------------------------------------------------------------ http_request

async function httpRequest(config: Record<string, any>): Promise<StepResult> {
  if (!config.url) throw new Error('http_request step is missing a url');
  const method = (config.method || 'GET').toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD' && config.body !== undefined;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(config.timeout_ms ?? 15000));

  try {
    const res = await fetch(String(config.url), {
      method,
      headers: {
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
        ...(config.headers ?? {}),
      },
      body: hasBody
        ? typeof config.body === 'string'
          ? config.body
          : JSON.stringify(config.body)
        : undefined,
      signal: controller.signal,
    });

    const raw = await res.text();
    let body: unknown = raw;
    if (config.parse_json !== false) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    // a non-2xx is thrown so the run loop's retry policy applies
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${config.url}`);

    const picked = config.pick ? pick(body, String(config.pick)) : undefined;
    return { output: { status: res.status, body, ...(picked !== undefined ? { picked } : {}) } };
  } finally {
    clearTimeout(timer);
  }
}

function pick(body: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, key) => (acc && typeof acc === 'object' ? (acc as any)[key] : undefined),
    body,
  );
}

// ---------------------------------------------------------------- db_write
// Writes are confined to workflow_artifacts. A step config can never name an
// arbitrary table, so a db_write can never touch permissions or another org.

async function dbWrite(step: StepExecution, config: Record<string, any>): Promise<StepResult> {
  const data = await adminGql<{ insert_workflow_artifacts_one: { id: string; key: string } }>(
    `mutation ($obj: workflow_artifacts_insert_input!) {
       insert_workflow_artifacts_one(object: $obj) { id key }
     }`,
    {
      obj: {
        org_id: step.orgId,
        workflow_run_id: step.runId,
        step_run_id: step.stepRunId,
        key: String(config.key ?? step.name),
        payload: config.payload ?? {},
      },
    },
  );
  return { output: { table: 'workflow_artifacts', ...data.insert_workflow_artifacts_one } };
}

// ------------------------------------------------------------------ notify
// The step only inserts the row; a Hasura Event Trigger on notifications does
// the actual delivery, which is what makes notify an event-driven step.

async function notify(step: StepExecution, config: Record<string, any>): Promise<StepResult> {
  const data = await adminGql<{ insert_notifications_one: { id: string } }>(
    `mutation ($obj: notifications_insert_input!) {
       insert_notifications_one(object: $obj) { id }
     }`,
    {
      obj: {
        org_id: step.orgId,
        workflow_run_id: step.runId,
        step_run_id: step.stepRunId,
        channel: config.channel === 'email' ? 'email' : 'slack',
        target: config.target ?? null,
        message: String(config.message ?? `Workflow step ${step.name} completed`),
      },
    },
  );
  return {
    output: {
      notification_id: data.insert_notifications_one.id,
      dispatched_via: 'hasura_event_trigger',
    },
  };
}

// ------------------------------------------------------ conditional_branch

function compare(left: unknown, operator: string, right: unknown): boolean {
  const l = left === null || left === undefined ? '' : left;
  switch (operator) {
    case 'equals':
      return String(l) === String(right);
    case 'not_equals':
      return String(l) !== String(right);
    case 'contains':
      return String(l).toLowerCase().includes(String(right).toLowerCase());
    case 'not_contains':
      return !String(l).toLowerCase().includes(String(right).toLowerCase());
    case 'gt':
      return Number(l) > Number(right);
    case 'gte':
      return Number(l) >= Number(right);
    case 'lt':
      return Number(l) < Number(right);
    case 'lte':
      return Number(l) <= Number(right);
    case 'regex':
      return new RegExp(String(right), 'i').test(String(l));
    case 'truthy':
      return Boolean(l) && l !== 'false' && l !== '0';
    default:
      throw new Error(`Unknown conditional operator: ${operator}`);
  }
}

function toControl(branch: any): StepControl {
  if (!branch || branch.action === 'continue') return { action: 'continue' };
  if (branch.action === 'stop') return { action: 'stop' };
  if (branch.action === 'skip_to') return { action: 'skip_to', position: Number(branch.position) };
  throw new Error(`Unknown branch action: ${branch.action}`);
}

function conditionalBranch(config: Record<string, any>): StepResult {
  const matched = compare(config.left, String(config.operator ?? 'truthy'), config.right);
  const control = toControl(matched ? config.if_true : config.if_false);
  return {
    output: { matched, left: config.left, operator: config.operator, right: config.right, control },
    control,
  };
}
