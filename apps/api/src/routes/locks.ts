import { lockAccounts, locks, properties, saveLockList, type Tx } from '@v01/db';
import { LockError, type LockProvider, type LockToken, type SecretBox } from '@v01/integrations';
import {
  can,
  type DoorCode,
  DoorCodeSchema,
  LockConnectSchema,
  type LocksView,
  LocksViewSchema,
  LockUpdateSchema,
} from '@v01/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type RequestScope, toIso } from '../context.ts';
import { HttpError } from '../errors.ts';

/**
 * Door locks (TTLock): connect the TTLock app account once, see its locks with battery and
 * gateway, put each on a property and turn codes on. The password goes to TTLock and is dropped;
 * only the token TTLock returns is kept, sealed. The codes themselves are made by the worker.
 */

const LockParams = z.object({ id: z.uuid() });

export interface LockRouteDeps {
  scope: RequestScope;
  /** Null when V-01 has no TTLock application set, or no key to seal the token with. */
  provider: LockProvider | null;
  box?: SecretBox;
}

async function view(tx: Tx, available: boolean): Promise<LocksView> {
  const [account] = await tx.select().from(lockAccounts).limit(1);
  const rows = await tx
    .select({
      id: locks.id,
      name: locks.name,
      propertyId: locks.propertyId,
      propertyName: properties.name,
      battery: locks.battery,
      hasGateway: locks.hasGateway,
      makesCodes: locks.makesCodes,
      lastSeenAt: locks.lastSeenAt,
    })
    .from(locks)
    .leftJoin(properties, eq(properties.id, locks.propertyId))
    .orderBy(sql`${properties.name} nulls last`, asc(locks.name));
  const [failed] = (
    await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from app.lock_codes where status = 'failed'`,
    )
  ).rows;
  return {
    available,
    account: account
      ? {
          username: account.username,
          status: account.status === 'error' ? 'error' : 'connected',
          error: account.lastError,
          syncedAt: account.syncedAt ? toIso(account.syncedAt) : null,
          gateways: account.gateways,
        }
      : null,
    locks: rows.map((r) => ({ ...r, lastSeenAt: r.lastSeenAt ? toIso(r.lastSeenAt) : null })),
    failedCodes: failed?.n ?? 0,
  };
}

function refused(error: unknown): never {
  if (error instanceof LockError) {
    throw new HttpError(
      error.kind === 'auth' ? 400 : 502,
      error.kind === 'auth' ? 'lock_sign_in_refused' : 'lock_maker_error',
      error.kind === 'auth'
        ? `TTLock refused the sign-in: ${error.message}. Use the TTLock app’s account, not the developer one.`
        : `TTLock answered: ${error.message}`,
    );
  }
  throw error;
}

export function lockRoutes(app: FastifyInstance, deps: LockRouteDeps) {
  const typed = app.withTypeProvider<ZodTypeProvider>();
  const ready = deps.provider !== null && deps.box !== undefined;
  const need = () => {
    if (!deps.provider || !deps.box) {
      throw new HttpError(
        503,
        'locks_unavailable',
        'V-01 isn’t set up for TTLock yet: its TTLock application is missing.',
      );
    }
    return { provider: deps.provider, box: deps.box };
  };

  typed.get('/v1/locks', { schema: { response: { 200: LocksViewSchema } } }, async (req) =>
    deps.scope.inOrg(req, 'properties.read', (tx) => view(tx, ready)),
  );

  /** A booking's door codes: which locks have it and from when; the digits for people who may read secrets. */
  typed.get(
    '/v1/reservations/:id/door-codes',
    { schema: { params: LockParams, response: { 200: z.object({ codes: z.array(DoorCodeSchema) }) } } },
    async (req) =>
      deps.scope.inOrg(req, 'reservations.read', async (tx, ctx) => {
        const rows = (
          await tx.execute<{
            lock_name: string;
            code_sealed: Buffer;
            status: DoorCode['status'];
            starts_at: string;
            ends_at: string;
            error: string | null;
          }>(sql`
            select l.name as lock_name, c.code_sealed, c.status, c.starts_at::text, c.ends_at::text, c.error
              from app.lock_codes c join app.locks l on l.id = c.lock_id
             where c.reservation_id = ${req.params.id} and c.status <> 'removed'
             order by l.name`)
        ).rows;
        const reveal = can(ctx.role, 'secrets.read') && deps.box;
        return {
          codes: rows.map((r) => ({
            lockName: r.lock_name,
            code: reveal && r.status === 'set' ? (deps.box?.open(Buffer.from(r.code_sealed)) ?? null) : null,
            status: r.status,
            startsAt: toIso(r.starts_at),
            endsAt: toIso(r.ends_at),
            error: r.error,
          })),
        };
      }),
  );

  typed.post(
    '/v1/locks/connect',
    { schema: { body: LockConnectSchema, response: { 200: LocksViewSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'locks.manage', async (tx, ctx) => {
        const { provider, box } = need();
        const token = await provider.signIn(req.body.username, req.body.password).catch(refused);
        const [account] = await tx
          .insert(lockAccounts)
          .values({
            organisationId: ctx.orgId,
            provider: provider.name,
            username: req.body.username,
            tokenSealed: box.seal(JSON.stringify(token)),
          })
          .onConflictDoUpdate({
            target: lockAccounts.organisationId,
            set: {
              username: req.body.username,
              tokenSealed: box.seal(JSON.stringify(token)),
              status: 'connected',
              lastError: null,
            },
          })
          .returning({ id: lockAccounts.id });
        if (!account) throw new Error('Saving the lock account returned nothing.');
        await refresh(tx, ctx.orgId, account.id, provider, token);
        return view(tx, ready);
      }),
  );

  typed.post('/v1/locks/refresh', { schema: { response: { 200: LocksViewSchema } } }, async (req) =>
    deps.scope.inOrg(req, 'locks.manage', async (tx, ctx) => {
      const { provider, box } = need();
      const [account] = await tx.select().from(lockAccounts).limit(1);
      if (!account) throw new HttpError(404, 'lock_account_missing', 'Connect the TTLock account first.');
      const opened = box.open(Buffer.from(account.tokenSealed));
      if (!opened) throw new HttpError(400, 'lock_sign_in_unreadable', 'Connect the TTLock account again.');
      await refresh(tx, ctx.orgId, account.id, provider, JSON.parse(opened) as LockToken);
      return view(tx, ready);
    }),
  );

  typed.delete('/v1/locks/account', { schema: { response: { 200: LocksViewSchema } } }, async (req) =>
    deps.scope.inOrg(req, 'locks.manage', async (tx) => {
      // The locks and their codes go with it; codes already on a lock run out on their own.
      await tx.delete(lockAccounts);
      return view(tx, ready);
    }),
  );

  typed.patch(
    '/v1/locks/:id',
    { schema: { params: LockParams, body: LockUpdateSchema, response: { 200: LocksViewSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'locks.manage', async (tx) => {
        const [lock] = await tx.select().from(locks).where(eq(locks.id, req.params.id));
        if (!lock) throw new HttpError(404, 'lock_not_found', 'That lock is not in this workspace.');
        const propertyId = req.body.propertyId === undefined ? lock.propertyId : req.body.propertyId;
        if (propertyId) {
          const [p] = await tx
            .select({ id: properties.id })
            .from(properties)
            .where(and(eq(properties.id, propertyId), isNull(properties.archivedAt)));
          if (!p)
            throw new HttpError(404, 'property_not_found', 'That property does not exist in this workspace.');
        }
        const makesCodes = req.body.makesCodes ?? (propertyId ? lock.makesCodes : false);
        if (makesCodes && !propertyId) {
          throw new HttpError(
            400,
            'lock_needs_property',
            'Put the lock on a property before turning codes on.',
          );
        }
        if (makesCodes && !lock.hasGateway) {
          throw new HttpError(
            400,
            'lock_needs_gateway',
            'This lock isn’t on a gateway, so codes can’t be sent to it. Pair it with a gateway in the TTLock app.',
          );
        }
        await tx.update(locks).set({ propertyId, makesCodes }).where(eq(locks.id, lock.id));
        return view(tx, ready);
      }),
  );
}

async function refresh(tx: Tx, orgId: string, accountId: string, provider: LockProvider, token: LockToken) {
  const [listed, gateways] = await Promise.all([
    provider.listLocks(token),
    provider.listGateways(token),
  ]).catch(refused);
  await saveLockList(tx, { orgId, accountId, locks: listed, gateways, at: new Date().toISOString() });
}
