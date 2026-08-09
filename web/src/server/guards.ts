import 'server-only';
import { serverEnv } from './env';
import { adminGql } from './admin';

export type SessionVariables = {
  'x-hasura-user-id'?: string;
  'x-hasura-role'?: string;
  [key: string]: string | undefined;
};

export type ActionPayload<T> = {
  action: { name: string };
  input: T;
  session_variables: SessionVariables;
  request_query?: string;
};

export class HandlerError extends Error {
  code: string;
  constructor(message: string, code = 'forbidden') {
    super(message);
    this.code = code;
  }
}

/** Only Hasura knows the shared secret, so nothing else can invoke a handler. */
export function assertHasuraCaller(req: Request) {
  const provided = req.headers.get('x-action-secret');
  if (!provided || provided !== serverEnv.actionSecret) {
    throw new HandlerError('This endpoint may only be called by Hasura.', 'unauthorized');
  }
}

export type Membership = { org_id: string; user_id: string; role: 'owner' | 'editor' | 'viewer' };

/**
 * Layer 1, re-checked server side.
 *
 * The Hasura row permissions already scope every read to the caller's org, but
 * the Action handler runs with the admin secret, so it must independently prove
 * the caller is a member of the workflow's org before touching anything. This
 * is what makes ID guessing useless: a valid Org B JWT with an Org A workflow
 * id resolves to zero memberships and is rejected here.
 */
export async function requireMembership(
  userId: string | undefined,
  orgId: string,
  allowed: Array<Membership['role']>,
): Promise<Membership> {
  if (!userId) throw new HandlerError('Not authenticated.', 'unauthenticated');

  const data = await adminGql<{ org_members: Membership[] }>(
    `query ($userId: uuid!, $orgId: uuid!) {
       org_members(where: {user_id: {_eq: $userId}, org_id: {_eq: $orgId}}) {
         org_id user_id role
       }
     }`,
    { userId, orgId },
  );

  const membership = data.org_members[0];
  // Deliberately identical message for "not a member" and "wrong role" so the
  // response never confirms that a given workflow id exists in another org.
  if (!membership || !allowed.includes(membership.role)) {
    throw new HandlerError('You do not have access to this resource.', 'forbidden');
  }
  return membership;
}

/** Hasura reads a non-2xx body as `{message, extensions}` and surfaces it as a GraphQL error. */
export function handlerResponse(err: unknown) {
  if (err instanceof HandlerError) {
    return Response.json({ message: err.message, extensions: { code: err.code } }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : 'Unexpected error';
  console.error('[handler]', err);
  return Response.json({ message, extensions: { code: 'internal' } }, { status: 500 });
}
