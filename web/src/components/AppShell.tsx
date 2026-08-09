'use client';

import { useMutation, useQuery } from '@apollo/client';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth, useRole } from '@/lib/providers';
import { CREATE_ORG, MY_MEMBERSHIPS, ORG_USAGE } from '@/lib/queries';
import { ErrorText, Meter, RoleBadge } from './ui';

type Membership = {
  id: string;
  org_id: string;
  role: string;
  organization: { id: string; name: string; slug: string };
};

export function AppShell({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();

  if (!ready) return <div className="center-page muted">Loading…</div>;
  if (!user) return <AuthScreen />;
  return <OrgGate>{children}</OrgGate>;
}

// ------------------------------------------------------------------- auth

function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'in') await signIn(email, password);
      else setNotice(await signUp(email, password, displayName || email.split('@')[0]));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-page">
      <form className="panel card" onSubmit={submit}>
        <h1>AI Agent Workflow Builder</h1>
        <p className="muted small" style={{ marginTop: 0 }}>
          Multi-tenant agent workflows on nhost + Hasura.
        </p>

        <div className="tabs" style={{ marginTop: 14 }}>
          <button type="button" className={mode === 'in' ? 'active' : ''} onClick={() => setMode('in')}>
            Sign in
          </button>
          <button type="button" className={mode === 'up' ? 'active' : ''} onClick={() => setMode('up')}>
            Create account
          </button>
        </div>

        {mode === 'up' && (
          <div className="field">
            <label>Display name</label>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Ada" />
          </div>
        )}
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="owner.a@demo.dev"
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <ErrorText error={error} />}
        {notice && <div className="alert ok">{notice}</div>}

        <button className="primary" style={{ width: '100%', marginTop: 10 }} disabled={busy}>
          {busy ? 'Working…' : mode === 'in' ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </div>
  );
}

// -------------------------------------------------------------- org gate

function OrgGate({ children }: { children: ReactNode }) {
  const { orgId, setOrg, userClient } = useRole();
  const { data, loading, error, refetch } = useQuery<{ org_members: Membership[] }>(MY_MEMBERSHIPS, {
    client: userClient,
    fetchPolicy: 'cache-and-network',
  });

  const memberships = data?.org_members ?? [];

  useEffect(() => {
    if (!memberships.length) return;
    const current = memberships.find((m) => m.org_id === orgId);
    if (current) setOrg(current.org_id, current.role);
    else setOrg(memberships[0].org_id, memberships[0].role);
  }, [memberships, orgId, setOrg]);

  if (loading && !data) return <div className="center-page muted">Loading organizations…</div>;
  if (error) {
    return (
      <div className="center-page">
        <div className="card">
          <ErrorText error={error} />
        </div>
      </div>
    );
  }
  if (!memberships.length) return <CreateOrgScreen onCreated={() => refetch()} />;
  if (!orgId) return <div className="center-page muted">Selecting organization…</div>;

  return (
    <>
      <TopBar memberships={memberships} />
      <div className="shell">{children}</div>
    </>
  );
}

function CreateOrgScreen({ onCreated }: { onCreated: () => void }) {
  const { userClient } = useRole();
  const { refresh } = useAuth();
  const [name, setName] = useState('');
  const [createOrg, { loading, error }] = useMutation(CREATE_ORG, { client: userClient });

  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return (
    <div className="center-page">
      <form
        className="panel card"
        onSubmit={async (e) => {
          e.preventDefault();
          await createOrg({ variables: { name, slug: `${slug}-${Math.random().toString(36).slice(2, 6)}` } });
          // the new membership grants owner/editor/viewer; the JWT needs re-minting
          await refresh();
          onCreated();
        }}
      >
        <h1>Create your organization</h1>
        <p className="muted small">You become its owner. Everything else lives inside an org.</p>
        <div className="field">
          <label>Organization name</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme AI" />
        </div>
        <ErrorText error={error} />
        <button className="primary" style={{ width: '100%' }} disabled={loading || !slug}>
          {loading ? 'Creating…' : 'Create organization'}
        </button>
      </form>
    </div>
  );
}

// --------------------------------------------------------------- top bar

function TopBar({ memberships }: { memberships: Membership[] }) {
  const { user, signOut } = useAuth();
  const { orgId, role, setOrg } = useRole();
  const current = memberships.find((m) => m.org_id === orgId);

  return (
    <div className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand" style={{ color: 'inherit' }}>
          ⚡ Workflow Builder
        </Link>

        <select
          style={{ width: 'auto', minWidth: 170 }}
          value={orgId ?? ''}
          onChange={(e) => {
            const next = memberships.find((m) => m.org_id === e.target.value);
            if (next) setOrg(next.org_id, next.role);
          }}
        >
          {memberships.map((m) => (
            <option key={m.org_id} value={m.org_id}>
              {m.organization.name}
            </option>
          ))}
        </select>
        <RoleBadge role={role} />
        {current && <QuotaPill orgId={current.org_id} />}

        <span className="spacer" />
        {role === 'owner' && <Link href="/members">Members</Link>}
        <span className="muted small">{user?.email}</span>
        <button className="sm ghost" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    </div>
  );
}

function QuotaPill({ orgId }: { orgId: string }) {
  const { data } = useQuery(ORG_USAGE, {
    variables: { orgId },
    pollInterval: 5000,
    fetchPolicy: 'cache-and-network',
  });
  const usage = data?.org_usage?.[0];
  if (!usage) return null;
  return (
    <div style={{ minWidth: 150 }}>
      <div className="small muted" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>quota</span>
        <span>
          {usage.quota_used}/{usage.quota_limit}
        </span>
      </div>
      <Meter used={usage.quota_used} limit={usage.quota_limit} />
    </div>
  );
}
