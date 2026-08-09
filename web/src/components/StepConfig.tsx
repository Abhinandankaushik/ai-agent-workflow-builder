'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash } from './icons';

/* ------------------------------------------------------------ primitives */

export function Text({
  label,
  value,
  onChange,
  placeholder,
  hint,
  disabled,
  mono,
}: {
  label: string;
  value: unknown;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  disabled?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        style={mono ? { fontFamily: 'var(--font-mono)', fontSize: 12 } : undefined}
      />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Num({
  label,
  value,
  onChange,
  step,
  min,
  max,
  disabled,
}: {
  label: string;
  value: unknown;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value === undefined || value === null ? '' : Number(value)}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        disabled={disabled}
      />
    </div>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
  hint,
  disabled,
}: {
  label: string;
  value: unknown;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Area({
  label,
  value,
  onChange,
  rows = 4,
  hint,
  prose,
  disabled,
}: {
  label: string;
  value: unknown;
  onChange: (v: string) => void;
  rows?: number;
  hint?: string;
  prose?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <textarea
        className={prose ? 'prose' : undefined}
        rows={rows}
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Toggle({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: unknown;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="check" style={{ marginTop: 4 }}>
      <input type="checkbox" checked={value !== false} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      {label}
    </label>
  );
}

/** Edits a flat string map without fighting the caret when a key is renamed. */
export function KeyValues({
  label,
  value,
  onChange,
  seed,
  disabled,
}: {
  label: string;
  value: Record<string, unknown> | undefined;
  onChange: (v: Record<string, string>) => void;
  seed: string;
  disabled?: boolean;
}) {
  const [rows, setRows] = useState<Array<[string, string]>>([]);

  useEffect(() => {
    setRows(Object.entries(value ?? {}).map(([k, v]) => [k, String(v)]));
    // re-seeding on the step id keeps typing stable while still resetting per step
  }, [seed]); // eslint-disable-line react-hooks/exhaustive-deps

  const push = (next: Array<[string, string]>) => {
    setRows(next);
    onChange(Object.fromEntries(next.filter(([k]) => k.trim())));
  };

  return (
    <div className="field">
      <label>{label}</label>
      <div className="stack-8">
        {rows.map(([k, v], i) => (
          <div className="kv-row" key={i}>
            <input
              value={k}
              placeholder="header"
              disabled={disabled}
              onChange={(e) => push(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
            <input
              value={v}
              placeholder="value"
              disabled={disabled}
              onChange={(e) => push(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
            <button
              type="button"
              className="btn icon sm ghost"
              disabled={disabled}
              onClick={() => push(rows.filter((_, j) => j !== i))}
              aria-label="Remove"
            >
              <Trash size={13} />
            </button>
          </div>
        ))}
        <button type="button" className="btn xs" disabled={disabled} onClick={() => push([...rows, ['', '']])}>
          <Plus size={12} />
          Add header
        </button>
      </div>
    </div>
  );
}

/** A JSON textarea that only propagates a change once the text parses. */
export function JsonArea({
  label,
  value,
  onChange,
  seed,
  rows = 6,
  hint,
  disabled,
}: {
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
  seed: string;
  rows?: number;
  hint?: string;
  disabled?: boolean;
}) {
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRaw(JSON.stringify(value ?? {}, null, 2));
    setError(null);
  }, [seed]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="field">
      <label>{label}</label>
      <textarea
        rows={rows}
        value={raw}
        disabled={disabled}
        onChange={(e) => {
          setRaw(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setError(null);
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }}
        style={error ? { borderColor: 'var(--err)' } : undefined}
      />
      {error ? <div className="hint" style={{ color: 'var(--err)' }}>{error}</div> : hint && <div className="hint">{hint}</div>}
    </div>
  );
}

/* --------------------------------------------------------- config editor */

const OPERATORS: Array<[string, string]> = [
  ['equals', 'equals'],
  ['not_equals', 'does not equal'],
  ['contains', 'contains'],
  ['not_contains', 'does not contain'],
  ['gt', 'greater than'],
  ['gte', 'greater or equal'],
  ['lt', 'less than'],
  ['lte', 'less or equal'],
  ['regex', 'matches regex'],
  ['truthy', 'is truthy'],
];

const BRANCH_ACTIONS: Array<[string, string]> = [
  ['continue', 'continue to the next step'],
  ['skip_to', 'jump to step…'],
  ['stop', 'stop the run here'],
];

type Cfg = Record<string, any>;

function Branch({
  title,
  value,
  onChange,
  stepCount,
  disabled,
}: {
  title: string;
  value: Cfg | undefined;
  onChange: (v: Cfg) => void;
  stepCount: number;
  disabled?: boolean;
}) {
  const action = value?.action ?? 'continue';
  return (
    <div
      style={{
        padding: '10px 12px',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r-sm)',
        background: 'var(--surface-2)',
      }}
    >
      <div className="label" style={{ marginBottom: 6 }}>
        {title}
      </div>
      <select value={action} disabled={disabled} onChange={(e) => onChange({ action: e.target.value, position: value?.position ?? 0 })}>
        {BRANCH_ACTIONS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {action === 'skip_to' && (
        <div style={{ marginTop: 8 }}>
          <select
            value={String(value?.position ?? 0)}
            disabled={disabled}
            onChange={(e) => onChange({ action: 'skip_to', position: Number(e.target.value) })}
          >
            {Array.from({ length: Math.max(stepCount, 1) }, (_, i) => (
              <option key={i} value={i}>
                step {i}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

export function ConfigEditor({
  type,
  config,
  onChange,
  seed,
  stepCount,
  disabled,
}: {
  type: string;
  config: Cfg;
  onChange: (next: Cfg) => void;
  seed: string;
  stepCount: number;
  disabled?: boolean;
}) {
  const set = (key: string, v: unknown) => onChange({ ...config, [key]: v });

  if (type === 'llm_call') {
    return (
      <>
        <div className="grid cols-3" style={{ gap: 12 }}>
          <Text label="Model" value={config.model} onChange={(v) => set('model', v)} disabled={disabled} mono />
          <Num label="Temperature" value={config.temperature ?? 0} onChange={(v) => set('temperature', v)} step={0.1} min={0} max={2} disabled={disabled} />
          <Num label="Max tokens" value={config.max_tokens ?? 300} onChange={(v) => set('max_tokens', v)} min={1} disabled={disabled} />
        </div>
        <Area label="System prompt" value={config.system} onChange={(v) => set('system', v)} rows={3} prose disabled={disabled} />
        <Area
          label="Prompt"
          value={config.prompt}
          onChange={(v) => set('prompt', v)}
          rows={4}
          prose
          disabled={disabled}
          hint="Templates: {{run.input.x}} · {{prev.output.x}} · {{steps.<step name>.output.x}}"
        />
        <Toggle label="Parse the reply as JSON into output.json" value={config.parse_json} onChange={(v) => set('parse_json', v)} disabled={disabled} />
      </>
    );
  }

  if (type === 'http_request') {
    return (
      <>
        <div className="grid" style={{ gridTemplateColumns: '120px minmax(0,1fr)', gap: 12 }}>
          <Select
            label="Method"
            value={config.method ?? 'GET'}
            onChange={(v) => set('method', v)}
            options={[['GET', 'GET'], ['POST', 'POST'], ['PUT', 'PUT'], ['PATCH', 'PATCH'], ['DELETE', 'DELETE']]}
            disabled={disabled}
          />
          <Text label="URL" value={config.url} onChange={(v) => set('url', v)} placeholder="https://api.example.com/thing" mono disabled={disabled} />
        </div>
        <KeyValues label="Headers" value={config.headers} onChange={(v) => set('headers', v)} seed={seed} disabled={disabled} />
        {config.method && config.method !== 'GET' && (
          <JsonArea label="Body" value={config.body ?? {}} onChange={(v) => set('body', v)} seed={seed} rows={4} disabled={disabled} />
        )}
        <div className="row" style={{ gap: 16 }}>
          <Toggle label="Parse the response as JSON" value={config.parse_json} onChange={(v) => set('parse_json', v)} disabled={disabled} />
        </div>
        <div className="hint">A non-2xx response throws, so the engine&apos;s retry policy applies.</div>
      </>
    );
  }

  if (type === 'conditional_branch') {
    return (
      <>
        <Text
          label="Left side"
          value={config.left}
          onChange={(v) => set('left', v)}
          placeholder="{{prev.output.json.sentiment}}"
          mono
          disabled={disabled}
          hint="Usually a template pointing at an earlier step's output."
        />
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 12 }}>
          <Select label="Operator" value={config.operator ?? 'equals'} onChange={(v) => set('operator', v)} options={OPERATORS} disabled={disabled} />
          <Text label="Right side" value={config.right} onChange={(v) => set('right', v)} placeholder="NEGATIVE" mono disabled={disabled} />
        </div>
        <div className="grid cols-2" style={{ gap: 12, marginTop: 12 }}>
          <Branch title="If true" value={config.if_true} onChange={(v) => set('if_true', v)} stepCount={stepCount} disabled={disabled} />
          <Branch title="If false" value={config.if_false} onChange={(v) => set('if_false', v)} stepCount={stepCount} disabled={disabled} />
        </div>
      </>
    );
  }

  if (type === 'approval_gate') {
    return (
      <>
        <Select
          label="Who may clear this gate"
          value={config.approver_role ?? 'owner'}
          onChange={(v) => set('approver_role', v)}
          options={[
            ['owner', 'Owners only'],
            ['editor', 'Owners and editors'],
          ]}
          disabled={disabled}
          hint="Checked inside the approveStep handler — a row permission cannot express this."
        />
        <Area label="Message shown to the approver" value={config.message} onChange={(v) => set('message', v)} rows={2} prose disabled={disabled} />
      </>
    );
  }

  if (type === 'db_write') {
    return (
      <>
        <Text label="Key" value={config.key} onChange={(v) => set('key', v)} placeholder="triage_result" mono disabled={disabled} />
        <JsonArea
          label="Payload"
          value={config.payload ?? {}}
          onChange={(v) => set('payload', v)}
          seed={seed}
          rows={6}
          disabled={disabled}
          hint="Values may be templates. Writes always land in workflow_artifacts — a step can never name another table."
        />
      </>
    );
  }

  if (type === 'notify') {
    return (
      <>
        <div className="grid" style={{ gridTemplateColumns: '150px minmax(0,1fr)', gap: 12 }}>
          <Select
            label="Channel"
            value={config.channel ?? 'slack'}
            onChange={(v) => set('channel', v)}
            options={[['slack', 'Slack'], ['email', 'Email']]}
            disabled={disabled}
          />
          <Text label="Target (optional)" value={config.target} onChange={(v) => set('target', v)} placeholder="override webhook URL" mono disabled={disabled} />
        </div>
        <Area
          label="Message"
          value={config.message}
          onChange={(v) => set('message', v)}
          rows={3}
          prose
          disabled={disabled}
          hint="The step only inserts a notifications row; a Hasura Event Trigger delivers it."
        />
      </>
    );
  }

  return <JsonArea label="Config" value={config} onChange={(v) => onChange(v as Cfg)} seed={seed} rows={8} disabled={disabled} />;
}
