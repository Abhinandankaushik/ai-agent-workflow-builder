'use client';

import { useSubscription } from '@apollo/client';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { History } from '@/components/icons';
import {
  Avatar,
  Empty,
  ErrorText,
  Skeleton,
  StatusBadge,
  TriggerPill,
  duration,
  relTime,
  useNow,
} from '@/components/ui';
import { useRole } from '@/lib/providers';
import { ORG_RUNS_LIVE } from '@/lib/queries';

export default function RunsPage() {
  return (
    <AppShell>
      <Runs />
    </AppShell>
  );
}

type Run = {
  id: string;
  status: string;
  trigger_type: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  workflow: { id: string; name: string } | null;
  initiator: { id: string; displayName: string; email: string } | null;
  step_runs: Array<{ id: string; status: string; type: string }>;
};

function Runs() {
  const { orgId } = useRole();
  const { data, error, loading } = useSubscription<{ workflow_runs: Run[] }>(ORG_RUNS_LIVE, {
    variables: { orgId },
    skip: !orgId,
  });

  const runs = data?.workflow_runs ?? [];
  const anyLive = runs.some((r) => r.status === 'running' || r.status === 'paused');
  useNow(anyLive);

  return (
    <>
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1>Runs</h1>
          <p className="muted small">
            Live feed over a GraphQL subscription — webhook, cron and database-event runs appear here
            without a refresh.
          </p>
        </div>
        <span className="badge accent">
          <span className="dot pulse" />
          streaming
        </span>
      </div>

      <ErrorText error={error} />

      <div className="card">
        {loading && !data && (
          <div style={{ padding: 18 }} className="stack-12">
            {[0, 1, 2].map((i) => (
              <Skeleton h={38} key={i} />
            ))}
          </div>
        )}

        {data && runs.length === 0 && (
          <Empty icon={<History size={20} />} title="No runs yet">
            Start one from a workflow, or fire a database event from the dashboard.
          </Empty>
        )}

        {runs.map((run) => {
          const total = run.step_runs.length;
          const done = run.step_runs.filter((s) =>
            ['succeeded', 'skipped', 'failed', 'rejected'].includes(s.status),
          ).length;
          const pct = total ? (done / total) * 100 : 0;
          const live = run.status === 'running';

          return (
            <Link key={run.id} href={`/runs/${run.id}`} className="list-row" style={{ display: 'flex' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row" style={{ gap: 8 }}>
                  <span className="strong truncate">{run.workflow?.name ?? 'Workflow'}</span>
                  <TriggerPill type={run.trigger_type} muted />
                </div>
                <div className="row tiny subtle" style={{ gap: 6, marginTop: 3 }}>
                  <span>{relTime(run.created_at)}</span>
                  <span>·</span>
                  <span className="tnum">{duration(run.started_at, run.finished_at)}</span>
                  <span>·</span>
                  <span>
                    {done}/{total} steps
                  </span>
                  {run.error && (
                    <>
                      <span>·</span>
                      <span style={{ color: 'var(--err)' }} className="truncate">
                        {run.error}
                      </span>
                    </>
                  )}
                </div>
                <div className={`progress ${live ? 'indeterminate' : ''}`} style={{ marginTop: 8, maxWidth: 340 }}>
                  <i style={live ? undefined : { width: `${pct}%` }} />
                </div>
              </div>

              <div className="row" style={{ gap: 10 }}>
                {run.initiator ? (
                  <span title={run.initiator.email}>
                    <Avatar name={run.initiator.displayName} email={run.initiator.email} />
                  </span>
                ) : (
                  <span className="tiny subtle nowrap">automated</span>
                )}
                <StatusBadge status={run.status} />
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
