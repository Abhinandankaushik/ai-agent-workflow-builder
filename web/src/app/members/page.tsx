'use client';

import { useMutation, useQuery } from '@apollo/client';
import Link from 'next/link';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { Lock, ShieldCheck, Trash, Users } from '@/components/icons';
import { Select } from '@/components/Select';
import { Alert, Avatar, Empty, ErrorText, RoleBadge, Skeleton } from '@/components/ui';
import { useAuth, useRole } from '@/lib/providers';
import { INVITE_MEMBER, ORG_MEMBERS, REMOVE_MEMBER, UPDATE_MEMBER_ROLE } from '@/lib/queries';

export default function MembersPage() {
  return (
    <AppShell>
      <Members />
    </AppShell>
  );
}

const ROLE_OPTIONS = [
  { value: 'owner', label: 'owner', hint: 'Full control' },
  { value: 'editor', label: 'editor', hint: 'Build and run' },
  { value: 'viewer', label: 'viewer', hint: 'Read only' },
];

const ROLE_MATRIX = [
  {
    role: 'owner',
    line: 'Everything an editor can do, plus membership management, db_write and notify steps, webhook triggers, and reading webhook secrets.',
  },
  {
    role: 'editor',
    line: 'Create and edit workflows, steps and non-privileged triggers. Start runs and clear approval gates.',
  },
  {
    role: 'viewer',
    line: 'Read workflows and run history. Cannot start a run or approve — enforced by the Action permission, not the UI.',
  },
];

function Members() {
  const { orgId, role } = useRole();
  const { user } = useAuth();
  const isOwner = role === 'owner';
  const { data, loading, error, refetch } = useQuery(ORG_MEMBERS, { variables: { orgId }, skip: !orgId });

  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState('editor');
  const [invite, { loading: inviting, error: inviteError, data: inviteData }] = useMutation(INVITE_MEMBER);
  const [updateRole] = useMutation(UPDATE_MEMBER_ROLE);
  const [removeMember] = useMutation(REMOVE_MEMBER);

  if (!isOwner) {
    return (
      <div className="card pad" style={{ maxWidth: 520 }}>
        <span
          className="brand-mark"
          style={{ width: 34, height: 34, borderRadius: 11, background: 'var(--surface-3)', color: 'var(--text-subtle)' }}
        >
          <Lock size={16} />
        </span>
        <h1 style={{ marginTop: 14 }}>Owners only</h1>
        <p className="muted small" style={{ marginTop: 6 }}>
          Membership management is restricted to organization owners. The <span className="mono">org_members</span>{' '}
          table rejects the mutation for your role regardless of what this page renders.
        </p>
        <Link className="btn" href="/" style={{ marginTop: 16 }}>
          Back to workflows
        </Link>
      </div>
    );
  }

  const members = data?.org_members ?? [];

  return (
    <>
      <div className="page-head">
        <div style={{ flex: 1 }}>
          <h1>Members</h1>
          <p className="muted small">
            Roles are per organization — the same person can be an owner here and a viewer elsewhere,
            because the role lives on the membership row rather than on the account.
          </p>
        </div>
      </div>

      <div className="grid main-rail">
        <div className="stack-16">
          <section className="card">
            <div className="card-head">
              <h2 style={{ flex: 1 }}>
                {members.length} member{members.length === 1 ? '' : 's'}
              </h2>
            </div>
            <ErrorText error={error} />
            {loading && !data && (
              <div className="card-body stack-12">
                {[0, 1, 2].map((i) => (
                  <Skeleton h={38} key={i} />
                ))}
              </div>
            )}
            {data && members.length === 0 && <Empty icon={<Users size={20} />} title="No members" />}
            {members.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Member</th>
                    <th style={{ width: 150 }}>Role</th>
                    <th style={{ width: 60 }} />
                  </tr>
                </thead>
                <tbody>
                  {members.map((m: any) => {
                    const isSelf = m.user?.id === user?.id;
                    return (
                      <tr key={m.id}>
                        <td>
                          <div className="row" style={{ gap: 10 }}>
                            <Avatar name={m.user?.displayName} email={m.user?.email} />
                            <div style={{ minWidth: 0 }}>
                              <div className="row" style={{ gap: 6 }}>
                                <span className="strong truncate">{m.user?.displayName || '—'}</span>
                                {isSelf && <span className="badge">you</span>}
                              </div>
                              <div className="tiny subtle truncate">{m.user?.email}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <Select
                            size="sm"
                            ariaLabel={`Role for ${m.user?.email}`}
                            value={m.role}
                            options={ROLE_OPTIONS}
                            onChange={async (role) => {
                              await updateRole({ variables: { id: m.id, role } });
                              refetch();
                            }}
                          />
                        </td>
                        <td>
                          <button
                            className="btn icon sm ghost"
                            aria-label="Remove member"
                            onClick={async () => {
                              await removeMember({ variables: { id: m.id } });
                              refetch();
                            }}
                          >
                            <Trash size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <ShieldCheck size={15} className="subtle" />
              <h2 style={{ flex: 1 }}>What each role can do</h2>
            </div>
            <div className="card-body stack-16">
              {ROLE_MATRIX.map((r) => (
                <div key={r.role} className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ width: 66, flex: 'none' }}>
                    <RoleBadge role={r.role} />
                  </div>
                  <p className="small muted" style={{ flex: 1 }}>
                    {r.line}
                  </p>
                </div>
              ))}
              <Alert tone="info">
                Demoting an owner also stops their existing <span className="mono">db_write</span> and{' '}
                <span className="mono">notify</span> steps from executing — the engine re-checks the
                step author&apos;s role on every run.
              </Alert>
            </div>
          </section>
        </div>

        <form
          className="card"
          onSubmit={async (e) => {
            e.preventDefault();
            await invite({ variables: { orgId, email, role: newRole } });
            setEmail('');
            refetch();
          }}
        >
          <div className="card-head">
            <h2 style={{ flex: 1 }}>Add a member</h2>
          </div>
          <div className="card-body">
            <p className="muted small" style={{ marginBottom: 14 }}>
              Handled by the owner-only <span className="mono">inviteMember</span> Action, which
              re-derives your membership server side before touching anything.
            </p>
            <div className="field">
              <label>Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="editor.a@demo.dev"
              />
              <div className="hint">The person must already have an account.</div>
            </div>
            <div className="field">
              <label>Role</label>
              <Select value={newRole} onChange={setNewRole} options={ROLE_OPTIONS} ariaLabel="Role" />
            </div>
            <ErrorText error={inviteError} />
            {inviteData && (
              <div style={{ marginTop: 10 }}>
                <Alert tone="ok">{inviteData.inviteMember.message}</Alert>
              </div>
            )}
            <button className="btn primary block" style={{ marginTop: 14 }} disabled={inviting}>
              {inviting ? 'Adding…' : 'Add member'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
