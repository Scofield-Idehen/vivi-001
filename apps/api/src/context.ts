import { type ApiDatabase, memberships, type Tx } from '@v01/db';
import { can, type MemberRole, type Permission } from '@v01/shared';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { type AuthUser, bearerToken, type TokenVerifier } from './auth.ts';
import { HttpError } from './errors.ts';

export interface OrgContext {
  orgId: string;
  userId: string;
  role: MemberRole;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Helpers every route uses. Routes never open their own transactions: they ask for a
 * scope, and the scope checks sign-in, membership and permission before any data is touched.
 */
export class RequestScope {
  constructor(
    private readonly db: ApiDatabase,
    private readonly verifyToken: TokenVerifier,
  ) {}

  async user(req: FastifyRequest): Promise<AuthUser> {
    const token = bearerToken(req.headers.authorization);
    if (!token) throw new HttpError(401, 'not_signed_in', 'Please sign in.');
    return this.verifyToken(token);
  }

  /**
   * Runs `fn` inside the operator chosen by the `x-org-id` header, after checking the
   * person belongs to it and their role allows `permission`. Row-level security in
   * Postgres also enforces the operator boundary, so a mistake here cannot leak data.
   */
  async inOrg<T>(
    req: FastifyRequest,
    permission: Permission,
    fn: (tx: Tx, ctx: OrgContext) => Promise<T>,
  ): Promise<T> {
    const user = await this.user(req);
    const orgId = req.headers['x-org-id'];
    if (typeof orgId !== 'string' || !UUID.test(orgId)) {
      throw new HttpError(400, 'workspace_required', 'Choose a workspace first.');
    }
    return this.db.withOrg({ orgId, userId: user.id }, async (tx) => {
      const [membership] = await tx
        .select({ role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.organisationId, orgId), eq(memberships.userId, user.id)));
      if (!membership) {
        throw new HttpError(403, 'not_a_member', 'You are not a member of this workspace.');
      }
      if (!can(membership.role, permission)) {
        throw new HttpError(403, 'not_allowed', 'Your role does not allow this.');
      }
      return fn(tx, { orgId, userId: user.id, role: membership.role });
    });
  }
}

/** The Postgres error code, whether or not Drizzle wrapped the driver error. */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let i = 0; i < 5 && current; i++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** Postgres timestamps come back as "2026-10-14 14:02:52.12+00"; the API speaks ISO 8601. */
export function toIso(value: string): string {
  const normalised = value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const date = new Date(normalised);
  if (Number.isNaN(date.getTime())) throw new Error(`Unreadable timestamp: ${value}`);
  return date.toISOString();
}
