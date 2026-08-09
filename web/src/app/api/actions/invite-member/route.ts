import { adminGql } from '@/server/admin';
import {
  assertHasuraCaller,
  handlerResponse,
  requireMembership,
  HandlerError,
  type ActionPayload,
} from '@/server/guards';

export const runtime = 'nodejs';
export const maxDuration = 30;

type Input = { org_id: string; email: string; role: string };

const ROLES = ['owner', 'editor', 'viewer'];

export async function POST(req: Request) {
  try {
    assertHasuraCaller(req);
    const payload = (await req.json()) as ActionPayload<Input>;
    const userId = payload.session_variables?.['x-hasura-user-id'];
    const { org_id, email, role } = payload.input;

    // Membership management is owner-only, both here and in the row permissions.
    await requireMembership(userId, org_id, ['owner']);

    if (!ROLES.includes(role)) {
      throw new HandlerError(`role must be one of ${ROLES.join(', ')}.`, 'invalid_role');
    }

    const found = await adminGql<{ users: Array<{ id: string; email: string }> }>(
      `query ($email: citext!) { users(where: {email: {_eq: $email}}) { id email } }`,
      { email: email.trim().toLowerCase() },
    );
    const user = found.users[0];
    if (!user) {
      throw new HandlerError('No user with that email has signed up yet.', 'user_not_found');
    }

    const inserted = await adminGql<{ insert_org_members_one: { id: string } }>(
      `mutation ($obj: org_members_insert_input!) {
         insert_org_members_one(
           object: $obj,
           on_conflict: {constraint: org_members_org_id_user_id_key, update_columns: [role]}
         ) { id }
       }`,
      { obj: { org_id, user_id: user.id, role } },
    );

    return Response.json({
      org_member_id: inserted.insert_org_members_one.id,
      user_id: user.id,
      message: `${user.email} is now a ${role}.`,
    });
  } catch (err) {
    return handlerResponse(err);
  }
}
