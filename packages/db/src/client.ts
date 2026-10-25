import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.ts';

export type Schema = typeof schema;
type Drizzle = NodePgDatabase<Schema>;
/** A transaction scoped to one operator (or one signed-in user). */
export type Tx = Parameters<Parameters<Drizzle['transaction']>[0]>[0];

export interface OrgScope {
  orgId: string;
  /** The signed-in person, recorded in the audit log. Null for system work. */
  userId?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, name: string): void {
  if (!UUID.test(value)) throw new Error(`${name} must be a UUID`);
}

export interface PoolOptions {
  max?: number;
  applicationName?: string;
  /**
   * Gives up on a query that hasn't answered in this long, instead of waiting for ever on a
   * connection the network dropped without saying so. Off by default; hand-run scripts set it.
   */
  queryTimeoutMs?: number;
}

function createPool(url: string, options: PoolOptions): pg.Pool {
  return new pg.Pool({
    connectionString: url,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'v01',
    idleTimeoutMillis: 30_000,
    // Notices a connection a router dropped silently, so a query fails rather than hangs.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    ...(options.queryTimeoutMs ? { query_timeout: options.queryTimeoutMs } : {}),
  });
}

/**
 * The only way application code reaches the database.
 *
 * Every query runs inside `withOrg` (or `withUser` before an operator is chosen),
 * which opens a transaction and sets `app.org_id` / `app.user_id`. Row-level
 * security in Postgres reads those settings, so a query that forgets to filter
 * by operator still only sees that operator's rows. Outside a scope, every
 * operator table returns nothing.
 *
 * Connect as `app_api` or `app_worker`, never as the owner: those roles cannot
 * bypass row-level security.
 */
export class Database {
  protected readonly pool: pg.Pool;
  protected readonly db: Drizzle;

  constructor(url: string, options: PoolOptions = {}) {
    this.pool = createPool(url, options);
    this.db = drizzle({ client: this.pool, schema });
  }

  withOrg<T>(scope: OrgScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    assertUuid(scope.orgId, 'orgId');
    if (scope.userId) assertUuid(scope.userId, 'userId');
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.org_id', ${scope.orgId}, true), set_config('app.user_id', ${scope.userId ?? ''}, true)`,
      );
      return fn(tx);
    });
  }

  /** For the signed-in person before an operator is chosen: their own profile and memberships only. */
  withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    assertUuid(userId, 'userId');
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
      return fn(tx);
    });
  }

  async ping(): Promise<void> {
    await this.pool.query('select 1');
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Connects as `app_api`. */
export class ApiDatabase extends Database {
  /** Turns pending invitations for this email into memberships. Returns how many were accepted. */
  async acceptInvitations(userId: string, email: string): Promise<number> {
    return this.withUser(userId, async (tx) => {
      const result = await tx.execute(
        sql`select app.accept_invitations(${userId}::uuid, ${email}) as accepted`,
      );
      return Number(result.rows[0]?.accepted ?? 0);
    });
  }

  /**
   * The guest's page for their stay, by the key in their link: a public read, with no operator in
   * scope, through a function that returns only what a guest may see. Null when the key is unknown
   * or the booking is not confirmed.
   */
  async guestStay(key: string): Promise<Record<string, unknown> | null> {
    const { rows } = await this.pool.query<{ stay: Record<string, unknown> | null }>(
      'select app.guest_stay($1) as stay',
      [key],
    );
    return rows[0]?.stay ?? null;
  }

  /** Stores a raw webhook before anything else happens. The API may insert but never read these. */
  async recordWebhook(event: {
    provider: string;
    event: string;
    externalPropertyId: string | null;
    payload: unknown;
  }): Promise<void> {
    await this.db.insert(schema.webhookEvents).values({
      provider: event.provider,
      event: event.event,
      externalPropertyId: event.externalPropertyId,
      payload: event.payload,
    });
  }
}

export interface ClaimedOutboxRow {
  id: number;
  organisationId: string;
  propertyId: string;
  kind: 'availability' | 'restrictions';
  dateFrom: string;
  dateTo: string;
  attempts: number;
}

export interface ClaimedWebhookEvent {
  id: number;
  provider: string;
  event: string;
  externalPropertyId: string | null;
  payload: unknown;
  attempts: number;
}

/**
 * Connects as `app_worker`. Adds the few narrow system functions that work across
 * operators (claiming queued work, resolving which operator a webhook belongs to).
 * Everything else still goes through `withOrg`.
 */
export class WorkerDatabase extends Database {
  async claimOutbox(limit: number): Promise<ClaimedOutboxRow[]> {
    const { rows } = await this.pool.query(
      'select id, organisation_id, property_id, kind, date_from::text, date_to::text, attempts from app.sys_claim_outbox($1)',
      [limit],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      organisationId: r.organisation_id,
      propertyId: r.property_id,
      kind: r.kind,
      dateFrom: r.date_from,
      dateTo: r.date_to,
      attempts: r.attempts,
    }));
  }

  async claimWebhookEvents(limit: number): Promise<ClaimedWebhookEvent[]> {
    const { rows } = await this.pool.query(
      'select id, provider, event, external_property_id, payload, attempts from app.sys_claim_webhook_events($1)',
      [limit],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      provider: r.provider,
      event: r.event,
      externalPropertyId: r.external_property_id,
      payload: r.payload,
      attempts: r.attempts,
    }));
  }

  /**
   * Marks a claimed webhook done. On error it stays locked, so it is retried
   * once the lock expires (five minutes), up to the attempt limit.
   */
  async finishWebhookEvent(
    id: number,
    result: { organisationId: string | null; error?: string },
  ): Promise<void> {
    await this.pool.query(
      `update app.webhook_events
          set processed_at = case when $3::text is null then now() else null end,
              organisation_id = coalesce($2::uuid, organisation_id),
              error = $3
        where id = $1`,
      [id, result.organisationId, result.error ?? null],
    );
  }

  async resolveChannexProperty(
    channexPropertyId: string,
  ): Promise<{ organisationId: string; propertyId: string } | null> {
    const { rows } = await this.pool.query(
      'select organisation_id, property_id from app.sys_resolve_channex_property($1)',
      [channexPropertyId],
    );
    const row = rows[0];
    return row ? { organisationId: row.organisation_id, propertyId: row.property_id } : null;
  }

  async listOrganisations(): Promise<{ id: string; name: string }[]> {
    const { rows } = await this.pool.query('select id, name from app.sys_list_organisations()');
    return rows;
  }

  /** One operator by its slug, for the worker's hand-run tools; null when there is none. */
  async findOrganisation(slug: string): Promise<{ id: string; name: string; slug: string } | null> {
    const { rows } = await this.pool.query('select id, name, slug from app.sys_organisation_by_slug($1)', [
      slug,
    ]);
    return rows[0] ?? null;
  }

  /**
   * Records a worker start and says how long V-01 was away: the gap since the previous run's last
   * heartbeat, or null when this is the first run ever. The caller decides whether that gap needs
   * a recovery (draining the booking feed before anything is sent).
   */
  async beginRun(now: Date = new Date()): Promise<{ runId: number; gapSeconds: number | null }> {
    const { rows: previous } = await this.pool.query<{ last_seen_at: Date }>(
      'select last_seen_at from app.worker_runs order by started_at desc limit 1',
    );
    const previousSeen = previous[0]?.last_seen_at ?? null;
    const gapSeconds = previousSeen
      ? Math.max(0, Math.round((now.getTime() - previousSeen.getTime()) / 1000))
      : null;
    const { rows } = await this.pool.query<{ id: number }>(
      `insert into app.worker_runs (started_at, last_seen_at, previous_seen_at, gap_seconds)
       values ($1, $1, $2, $3) returning id`,
      [now, previousSeen, gapSeconds],
    );
    return { runId: Number(rows[0]?.id), gapSeconds };
  }

  /** A kept access token for an outside service (Guesty), or null. */
  async loadToken(
    provider: string,
    clientId: string,
  ): Promise<{ accessToken: string; expiresAt: string } | null> {
    const { rows } = await this.pool.query<{ access_token: string; expires_at: Date }>(
      'select access_token, expires_at from app.integration_tokens where provider = $1 and client_id = $2',
      [provider, clientId],
    );
    const row = rows[0];
    return row ? { accessToken: row.access_token, expiresAt: row.expires_at.toISOString() } : null;
  }

  async saveToken(
    provider: string,
    clientId: string,
    token: { accessToken: string; expiresAt: string },
    remainingToday: number | null,
  ): Promise<void> {
    await this.pool.query(
      `insert into app.integration_tokens (provider, client_id, access_token, expires_at, remaining_today)
       values ($1, $2, $3, $4, $5)
       on conflict (provider, client_id) do update
         set access_token = excluded.access_token, expires_at = excluded.expires_at,
             remaining_today = excluded.remaining_today, created_at = now()`,
      [provider, clientId, token.accessToken, token.expiresAt, remainingToday],
    );
  }

  async heartbeat(runId: number, now: Date = new Date()): Promise<void> {
    await this.pool.query('update app.worker_runs set last_seen_at = $2 where id = $1', [runId, now]);
  }

  async setRecovery(
    runId: number,
    recovery: 'draining' | 'done',
    drainedRevisions: number,
    now: Date = new Date(),
  ): Promise<void> {
    await this.pool.query(
      `update app.worker_runs
          set recovery = $2, drained_revisions = $3, recovered_at = case when $2 = 'done' then $4 else recovered_at end
        where id = $1`,
      [runId, recovery, drainedRevisions, now],
    );
  }
}
