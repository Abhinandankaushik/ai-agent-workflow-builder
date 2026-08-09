'use client';

import { useMutation, useQuery } from '@apollo/client';
import Link from 'next/link';
import { useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ErrorText, RoleBadge } from '@/components/ui';
import { useRole } from '@/lib/providers';
import { INVITE_MEMBER, ORG_MEMBERS, REMOVE_MEMBER, UPDATE_MEMBER_ROLE } from '@/lib/queries';

export default function MembersPage() {
  return (
    <AppShell>
      <Members />
    </AppShell>
  );
}

function Members() {
  const { orgId, role } = useRole();
  const isOwner = role === 'owner';
  const { data, loading, error, refetch } = useQuery(ORG_MEMBERS, { variables: { orgId }, skip: !orgId });

  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState('editor');
  const [invite, { loading: inviting, error: inviteError, data: inviteData }] = useMutation(INVITE_MEMBER);
  const [updateRole] = useMutation(UPDATE_MEMBER_ROLE);
  const [removeMember] = useMutation(REMOVE_MEMBER);

  if (!isOwner) {
    return (
      <div className="panel">
        <h1>Members</h1>
        <p className="muted">
          Only an organization owner can manage membership. This page is not reachable for your role,
          and the underlying tables reject the mutation regardless of the UI.
        </p>
        <Link href="/">Back to workflows</Link>
      </div>
    );
  }

  return (
    <>
      <Link className="small muted" href="/">
        ← all workflows
      </Link>
      <h1 style={{ marginTop: 4 }}>Members</h1>
      <p className="muted small">
        Roles are per organization: the same person can be an owner here and a viewer elsewhere.
      </p>

      <div className="grid two">
        <div className="panel">
          {loading && <div className="muted">Loading…</div>}
          <ErrorText error={error} />
          <table>
            <thead>
              <tr>
                <th>user</th>
                <th>role</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.org_members?.map((m: any) => (
                <tr key={m.id}>
                  <td>
                    <div>{m.user?.displayName || '—'}</div>
                    <div className="small muted">{m.user?.email}</div>
                  </td>
                  <td>
                    <select
                      style={{ width: 'auto' }}
                      value={m.role}
                      onChange={async (e) => {
                        await updateRole({ variables: { id: m.id, role: e.target.value } });
                        refetch();
                      }}
                    >
                      <option value="owner">owner</option>
                      <option value="editor">editor</option>
                      <option value="viewer">viewer</option>
                    </select>
                  </td>
                  <td>
                    <button
                      className="sm danger"
                      onClick={async () => {
                        await removeMember({ variables: { id: m.id } });
                        refetch();
                      }}
                    >
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form
          className="panel"
          onSubmit={async (e) => {
            e.preventDefault();
            await invite({ variables: { orgId, email, role: newRole } });
            setEmail('');
            refetch();
          }}
        >
          <h2>Add a member</h2>
          <p className="muted small" style={{ marginTop: 0 }}>
            The person must already have an nhost account. Handled by the owner-only{' '}
            <span className="mono">inviteMember</span> Action.
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
          </div>
          <div className="field">
            <label>Role</label>
            <select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
              <option value="owner">owner</option>
              <option value="editor">editor</option>
              <option value="viewer">viewer</option>
            </select>
          </div>
          <ErrorText error={inviteError} />
          {inviteData && <div className="alert ok small">{inviteData.inviteMember.message}</div>}
          <button className="primary" disabled={inviting}>
            {inviting ? 'Adding…' : 'Add member'}
          </button>
          <div className="row small muted" style={{ marginTop: 12 }}>
            <RoleBadge role="owner" /> full control incl. db_write / notify steps and webhook triggers
          </div>
          <div className="row small muted">
            <RoleBadge role="editor" /> build + run workflows, no privileged step types
          </div>
          <div className="row small muted">
            <RoleBadge role="viewer" /> read only, cannot trigger or approve
          </div>
        </form>
      </div>
    </>
  );
}
