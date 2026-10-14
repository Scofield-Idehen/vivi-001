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
}

function createPool(url: string, options: PoolOptions): pg.Pool {
  return new pg.Pool({
    connectionString: url,
    max: options.max ?? 10,
    application_name: options.applicationName ?? 'v01',
    idleTimeoutMillis: 30_000,
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
}
