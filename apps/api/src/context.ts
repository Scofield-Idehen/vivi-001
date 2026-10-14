import { type ApiDatabase, memberships, type Tx } from '@v01/db';
import {
  can,
  canPlatform,
  type Permission,
  type PlatformPermission,
  type PlatformRole,
  SUPPORT_ROLE,
  type WorkspaceRole,
} from '@v01/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { type AuthUser, bearerToken, type TokenVerifier } from './auth.ts';
import { HttpError } from './errors.ts';

export interface OrgContext {
  orgId: string;
  userId: string;
  role: WorkspaceRole;
  /** Set when a V-01 staff member is here on a support grant: read-only, and every request logged. */
  supportGrantId: string | null;
}

export interface StaffContext {
  userId: string;
  email: string;
  role: PlatformRole;
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
   *
   * V-01 staff who are not members get in only on an open support grant: read-only,
   * time-limited, and every request (allowed or refused) is logged where the operator can see it.
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
      if (membership) {
        if (!can(membership.role, permission)) {
          throw new HttpError(403, 'not_allowed', 'Your role does not allow this.');
        }
        return fn(tx, { orgId, userId: user.id, role: membership.role, supportGrantId: null });
      }

      const grant = await tx.execute(sql`select app.active_support_grant(${orgId}::uuid) as id`);
      const grantId = (grant.rows[0]?.id as string | null | undefined) ?? null;
      if (!grantId) {
        throw new HttpError(403, 'not_a_member', 'You are not a member of this workspace.');
      }
      const allowed = can(SUPPORT_ROLE, permission);
      await this.logSupportRequest(user.id, grantId, req, allowed);
      if (!allowed) {
        throw new HttpError(403, 'support_read_only', 'Support access is read-only.');
      }
      return fn(tx, { orgId, userId: user.id, role: SUPPORT_ROLE, supportGrantId: grantId });
    });
  }

  /**
   * Runs `fn` for a V-01 staff member whose role allows `permission`. The console functions in
   * the database check the role again, so a route that forgets to ask here still gets nothing.
   */
  async asStaff<T>(
    req: FastifyRequest,
    permission: PlatformPermission,
    fn: (tx: Tx, ctx: StaffContext) => Promise<T>,
  ): Promise<T> {
    const user = await this.user(req);
    return this.db.withUser(user.id, async (tx) => {
      const result = await tx.execute(sql`select app.platform_role() as role`);
      const role = (result.rows[0]?.role as PlatformRole | null | undefined) ?? null;
      if (!role) throw new HttpError(403, 'not_platform_staff', 'This area is for V-01 staff.');
      if (!canPlatform(role, permission)) {
        throw new HttpError(403, 'not_allowed', 'Your V-01 role does not allow this.');
      }
      return fn(tx, { userId: user.id, email: user.email, role });
    });
  }

  /** In its own transaction, so the record stays even if the request then fails. */
  private async logSupportRequest(
    userId: string,
    grantId: string,
    req: FastifyRequest,
    allowed: boolean,
  ): Promise<void> {
    await this.db.withUser(userId, (tx) =>
      tx.execute(
        sql`select app.log_support_request(${grantId}::uuid, ${req.method}, ${req.url}, ${allowed})`,
      ),
    );
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

/** The constraint a Postgres error names, if any, whether or not Drizzle wrapped it. */
export function pgConstraint(error: unknown): string | undefined {
  let current: unknown = error;
  for (let i = 0; i < 5 && current; i++) {
    const constraint = (current as { constraint?: unknown }).constraint;
    if (typeof constraint === 'string') return constraint;
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

/** A timestamp from a raw query, which may arrive as a string or a Date. */
export function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return toIso(String(value));
}
