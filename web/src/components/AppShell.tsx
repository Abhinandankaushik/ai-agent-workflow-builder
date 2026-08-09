'use client';

import { useMutation, useQuery } from '@apollo/client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth, useRole } from '@/lib/providers';
import { ThemeToggle } from '@/lib/theme';
import { CREATE_ORG, MY_MEMBERSHIPS, ORG_USAGE } from '@/lib/queries';
import {
  Bolt,
  ChevronDown,
  Flow,
  Gauge,
  History,
  Layers,
  Lock,
  LogOut,
  Menu,
  ShieldCheck,
  Sparkles,
  Users,
  Webhook,
} from './icons';
import { MenuItem, MenuLabel, Popover } from './Select';
import { Alert, Avatar, ErrorText, Meter, RoleBadge, Skeleton } from './ui';

type Membership = {
  id: string;
  org_id: string;
  role: string;
  organization: { id: string; name: string; slug: string };
};

export function AppShell({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth();
  if (!ready) return <BootSplash />;
  if (!user) return <AuthScreen />;
  return <OrgGate>{children}</OrgGate>;
}

function BootSplash() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <div className="col" style={{ alignItems: 'center', gap: 14 }}>
        <span className="brand-mark" style={{ width: 38, height: 38, borderRadius: 12 }}>
          <Bolt size={20} />
        </span>
        <Skeleton h={6} w={110} />
      </div>
    </div>
  );
}

/* ============================================================== auth screen */

const DEMO_ACCOUNTS = [
  { email: 'owner.a@demo.dev', org: 'Acme AI', role: 'owner' },
  { email: 'editor.a@demo.dev', org: 'Acme AI', role: 'editor' },
  { email: 'viewer.a@demo.dev', org: 'Acme AI', role: 'viewer' },
  { email: 'owner.b@demo.dev', org: 'Globex', role: 'owner' },
];

const FEATURES = [
  { icon: Sparkles, title: 'Real agent steps', body: 'LLM calls, HTTP requests, branches and DB writes chained in order, with retries.' },
  { icon: ShieldCheck, title: 'Two permission layers', body: 'Org + role scoping in Hasura, plus step-level gating enforced inside the Action handler.' },
  { icon: Webhook, title: 'Four ways to start', body: 'Manual, inbound webhook, cron schedule, or a database row change.' },
];

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
    <div className="auth">
      <aside className="auth-brand">
        <div className="row" style={{ gap: 10 }}>
          <span className="brand-mark">
            <Bolt size={16} />
          </span>
          <div>
            <div className="brand-name" style={{ color: '#fff' }}>
              Workflow Builder
            </div>
            <div className="brand-sub" style={{ color: 'rgba(255,255,255,0.55)' }}>
              nhost · hasura · postgres
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 420 }}>
          <h2 style={{ fontSize: 30, lineHeight: 1.15, letterSpacing: '-0.03em', fontWeight: 640 }}>
            Chain AI agent steps.
            <br />
            Watch every one of them live.
          </h2>
          <p style={{ marginTop: 12, color: 'rgba(255,255,255,0.62)', fontSize: 14 }}>
            A multi-tenant workflow engine where a run can pause mid-execution for a human, resume on
            approval, and stream its progress step by step over a GraphQL subscription.
          </p>

          <div className="stack-16" style={{ marginTop: 30 }}>
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <div className="feature" key={title}>
                <span className="feature-ico">
                  <Icon size={15} />
                </span>
                <div>
                  <div style={{ fontWeight: 570, fontSize: 13.5 }}>{title}</div>
                  <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12.5, lineHeight: 1.5 }}>{body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="tiny" style={{ color: 'rgba(255,255,255,0.36)' }}>
          Two organizations, four roles, zero cross-tenant leakage.
        </div>
      </aside>

      <div className="auth-form-wrap">
        <div className="auth-form">
          <h1 style={{ fontSize: 24 }}>{mode === 'in' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="muted small" style={{ marginTop: 4 }}>
            {mode === 'in'
              ? 'Sign in to your organization workspace.'
              : 'You will be asked to create an organization next.'}
          </p>

          <div className="segmented" style={{ marginTop: 18, marginBottom: 18, width: '100%' }}>
            <button
              type="button"
              style={{ flex: 1 }}
              className={mode === 'in' ? 'active' : ''}
              onClick={() => setMode('in')}
            >
              Sign in
            </button>
            <button
              type="button"
              style={{ flex: 1 }}
              className={mode === 'up' ? 'active' : ''}
              onClick={() => setMode('up')}
            >
              Sign up
            </button>
          </div>

          <form onSubmit={submit}>
            {mode === 'up' && (
              <div className="field">
                <label htmlFor="name">Display name</label>
                <input id="name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Ada Lovelace" />
              </div>
            )}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
              />
            </div>
            <div className="field">
              <label htmlFor="pw">Password</label>
              <input
                id="pw"
                type="password"
                required
                minLength={8}
                autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error && <ErrorText error={error} />}
            {notice && (
              <div style={{ marginTop: 10 }}>
                <Alert tone="ok">{notice}</Alert>
              </div>
            )}

            <button className="btn primary block" style={{ marginTop: 16, height: 38 }} disabled={busy}>
              {busy ? 'Working…' : mode === 'in' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          {mode === 'in' && (
            <>
              <div className="row" style={{ margin: '22px 0 10px' }}>
                <hr style={{ flex: 1, margin: 0 }} />
                <span className="tiny subtle nowrap">or use a demo account</span>
                <hr style={{ flex: 1, margin: 0 }} />
              </div>
              <div className="stack-8">
                {DEMO_ACCOUNTS.map((a) => (
                  <button
                    key={a.email}
                    type="button"
                    className="demo-account"
                    onClick={() => {
                      setEmail(a.email);
                      setPassword('Password123!');
                      setError(null);
                    }}
                  >
                    <Avatar email={a.email} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="small strong truncate" style={{ display: 'block' }}>
                        {a.email}
                      </span>
                      <span className="tiny subtle">{a.org}</span>
                    </span>
                    <RoleBadge role={a.role} />
                  </button>
                ))}
              </div>
              <p className="tiny subtle center" style={{ marginTop: 10 }}>
                Click one to fill the form — password is <span className="mono">Password123!</span>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================ org gate */

function OrgGate({ children }: { children: ReactNode }) {
  const { orgId, setOrg, userClient } = useRole();
  const { data, loading, error, refetch } = useQuery<{ org_members: Membership[] }>(MY_MEMBERSHIPS, {
    client: userClient,
    fetchPolicy: 'cache-and-network',
  });
  const [navOpen, setNavOpen] = useState(false);
  const pathname = usePathname();

  const memberships = data?.org_members ?? [];

  useEffect(() => {
    if (!memberships.length) return;
    const current = memberships.find((m) => m.org_id === orgId);
    if (current) setOrg(current.org_id, current.role);
    else setOrg(memberships[0].org_id, memberships[0].role);
  }, [memberships, orgId, setOrg]);

  useEffect(() => setNavOpen(false), [pathname]);

  if (loading && !data) return <BootSplash />;
  if (error) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
        <div style={{ maxWidth: 420 }}>
          <ErrorText error={error} />
        </div>
      </div>
    );
  }
  if (!memberships.length) return <CreateOrgScreen onCreated={() => refetch()} />;
  if (!orgId) return <BootSplash />;

  return (
    <div className="app">
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      <Sidebar memberships={memberships} open={navOpen} />
      <div className="main">
        <header className="topbar">
          <button className="btn icon sm ghost menu-btn" onClick={() => setNavOpen((v) => !v)} aria-label="Menu">
            <Menu size={16} />
          </button>
          <OrgSwitcher memberships={memberships} />
          <span className="spacer" />
          <ThemeToggle />
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}

function OrgSwitcher({ memberships }: { memberships: Membership[] }) {
  const { orgId, role, setOrg } = useRole();
  const [open, setOpen] = useState(false);
  const current = memberships.find((m) => m.org_id === orgId);

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      align="left"
      minWidth={248}
      trigger={
        <button
          type="button"
          className={`org-trigger ${open ? 'open' : ''}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="avatar" style={{ borderRadius: 8 }}>
            {(current?.organization.name ?? '?').slice(0, 2).toUpperCase()}
          </span>
          <span className="strong truncate" style={{ fontSize: 13.5, maxWidth: 180 }}>
            {current?.organization.name}
          </span>
          <RoleBadge role={role} />
          <ChevronDown
            size={14}
            className="subtle"
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .18s' }}
          />
        </button>
      }
    >
      <MenuLabel>Switch organization</MenuLabel>
      {memberships.map((m) => (
        <MenuItem
          key={m.org_id}
          selected={m.org_id === orgId}
          onSelect={() => {
            setOrg(m.org_id, m.role);
            setOpen(false);
          }}
        >
          <span className="avatar" style={{ borderRadius: 7, width: 22, height: 22, fontSize: 9.5 }}>
            {m.organization.name.slice(0, 2).toUpperCase()}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="truncate" style={{ display: 'block' }}>
              {m.organization.name}
            </span>
            <span className="tiny subtle">{m.role}</span>
          </span>
        </MenuItem>
      ))}
    </Popover>
  );
}

function Sidebar({ memberships, open }: { memberships: Membership[]; open: boolean }) {
  const { user, signOut } = useAuth();
  const { role } = useRole();
  const pathname = usePathname();

  const items = [
    { href: '/', label: 'Workflows', icon: Flow, match: (p: string) => p === '/' || p.startsWith('/workflows') },
    { href: '/runs', label: 'Runs', icon: History, match: (p: string) => p.startsWith('/runs') },
    ...(role === 'owner'
      ? [{ href: '/members', label: 'Members', icon: Users, match: (p: string) => p.startsWith('/members') }]
      : []),
  ];

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <Link href="/" className="brand">
        <span className="brand-mark">
          <Bolt size={16} />
        </span>
        <span>
          <span className="brand-name" style={{ display: 'block' }}>
            Workflow Builder
          </span>
          <span className="brand-sub">{memberships.length} organization{memberships.length === 1 ? '' : 's'}</span>
        </span>
      </Link>

      <nav className="nav">
        <div className="nav-label">Workspace</div>
        {items.map(({ href, label, icon: Icon, match }) => (
          <Link key={href} href={href} className={`nav-item ${match(pathname) ? 'active' : ''}`}>
            <Icon size={16} />
            {label}
          </Link>
        ))}
      </nav>

      <UsageCard />

      <div className="sidebar-foot">
        <RoleHint role={role} />
        <div className="userchip">
          <Avatar name={user?.displayName} email={user?.email} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="small strong truncate" style={{ display: 'block' }}>
              {user?.displayName || user?.email?.split('@')[0]}
            </span>
            <span className="tiny subtle truncate" style={{ display: 'block' }}>
              {user?.email}
            </span>
          </span>
          <button className="btn icon xs ghost" onClick={() => signOut()} aria-label="Sign out" title="Sign out">
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function RoleHint({ role }: { role: string }) {
  const copy: Record<string, string> = {
    owner: 'Full control, including db_write / notify steps and webhook triggers.',
    editor: 'Can build and run workflows. Privileged step types are locked.',
    viewer: 'Read-only. Running and approving are blocked server side.',
  };
  return (
    <div
      className="small"
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'flex-start',
        padding: '9px 10px',
        borderRadius: 'var(--r-md)',
        background: 'var(--surface-2)',
        border: '1px solid var(--border)',
        color: 'var(--text-subtle)',
        fontSize: 11.5,
        lineHeight: 1.45,
      }}
    >
      <Lock size={13} style={{ flex: 'none', marginTop: 1 }} />
      <span>{copy[role] ?? 'Signed in.'}</span>
    </div>
  );
}

function UsageCard() {
  const { orgId } = useRole();
  const { data } = useQuery(ORG_USAGE, {
    variables: { orgId },
    skip: !orgId,
    pollInterval: 6000,
    fetchPolicy: 'cache-and-network',
  });
  const usage = data?.org_usage?.[0];

  return (
    <div
      style={{
        padding: '11px 12px',
        borderRadius: 'var(--r-md)',
        border: '1px solid var(--border)',
        background: 'var(--surface-2)',
      }}
    >
      <div className="row between" style={{ marginBottom: 7 }}>
        <span className="row" style={{ gap: 6, fontSize: 11.5, fontWeight: 560, color: 'var(--text-muted)' }}>
          <Gauge size={13} />
          Run quota
        </span>
        <span className="tnum tiny subtle">
          {usage ? `${usage.quota_used}/${usage.quota_limit}` : '—'}
        </span>
      </div>
      <Meter used={usage?.quota_used ?? 0} limit={usage?.quota_limit ?? 1} />
      <div className="row between tiny subtle" style={{ marginTop: 7 }}>
        <span>{usage?.runs_this_period ?? 0} runs this period</span>
        <span className="tnum">{usage?.avg_run_seconds ?? 0}s avg</span>
      </div>
    </div>
  );
}

/* ========================================================== first-run setup */

function CreateOrgScreen({ onCreated }: { onCreated: () => void }) {
  const { userClient } = useRole();
  const { refresh, signOut } = useAuth();
  const [name, setName] = useState('');
  const [createOrg, { loading, error }] = useMutation(CREATE_ORG, { client: userClient });

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
      <form
        className="card pad rise"
        style={{ width: '100%', maxWidth: 420 }}
        onSubmit={async (e) => {
          e.preventDefault();
          await createOrg({ variables: { name, slug: `${slug}-${Math.random().toString(36).slice(2, 6)}` } });
          // the new membership grants owner/editor/viewer; the JWT needs re-minting
          await refresh();
          onCreated();
        }}
      >
        <span className="brand-mark" style={{ width: 34, height: 34, borderRadius: 11 }}>
          <Layers size={17} />
        </span>
        <h1 style={{ marginTop: 14 }}>Create your organization</h1>
        <p className="muted small" style={{ marginTop: 4, marginBottom: 18 }}>
          Everything — workflows, runs, quota, members — lives inside an organization. You become its
          first owner.
        </p>
        <div className="field">
          <label htmlFor="orgname">Organization name</label>
          <input
            id="orgname"
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme AI"
          />
          {slug && <div className="hint mono">slug: {slug}</div>}
        </div>
        <ErrorText error={error} />
        <button className="btn primary block" style={{ marginTop: 16, height: 38 }} disabled={loading || !slug}>
          {loading ? 'Creating…' : 'Create organization'}
        </button>
        <button type="button" className="btn ghost block sm" style={{ marginTop: 8 }} onClick={() => signOut()}>
          Sign out
        </button>
      </form>
    </div>
  );
}
