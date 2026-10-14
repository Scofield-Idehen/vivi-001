import type { Tx } from '@v01/db';
import {
  CHANNELS,
  type Channel,
  type ConsoleOperator,
  ConsoleOperatorDetailSchema,
  ConsoleOperatorListSchema,
  ConsoleOverviewSchema,
  ConsoleSyncSchema,
  canPlatform,
  MEMBER_ROLES,
  type MemberRole,
  SupportAccessStartSchema,
  type SupportGrant,
  SupportGrantListSchema,
  SupportGrantSchema,
} from '@v01/shared';
import { type SQL, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { isoOrNull, pgErrorCode, type RequestScope } from '../context.ts';
import { HttpError } from '../errors.ts';

/**
 * The V-01 console. Every read goes through the console functions in the database, which check
 * the caller is V-01 staff and return totals, statuses and operator metadata, never guests' details.
 */

type Row = Record<string, unknown>;

async function rows(tx: Tx, query: SQL): Promise<Row[]> {
  return (await tx.execute(query)).rows as Row[];
}

const count = (value: unknown): number => Number(value ?? 0);
const text = (value: unknown): string => String(value ?? '');
const textOrNull = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);
const iso = (value: unknown): string => isoOrNull(value) ?? new Date(0).toISOString();

function channels(value: unknown): Channel[] {
  const list = Array.isArray(value) ? value : [];
  return list.filter((c): c is Channel => (CHANNELS as readonly string[]).includes(String(c)));
}

function toOperator(r: Row): ConsoleOperator {
  const propertiesOnV01 = count(r.properties_on_v01);
  return {
    id: text(r.id),
    name: text(r.name),
    slug: text(r.slug),
    createdAt: iso(r.created_at),
    status: propertiesOnV01 > 0 ? 'live' : 'onboarding',
    properties: count(r.properties),
    propertiesOnV01,
    propertiesOnGuesty: count(r.properties_on_guesty),
    members: count(r.members),
    channelAccounts: count(r.channel_accounts),
    channelAccountsConnected: count(r.channel_accounts_connected),
    channels: channels(r.channels),
    outboxWaiting: count(r.outbox_waiting),
    outboxFailed: count(r.outbox_failed),
    webhooksFailed: count(r.webhooks_failed),
    lastActivityAt: isoOrNull(r.last_activity_at),
    supportActive: Boolean(r.support_active),
  };
}

function toGrant(r: Row): SupportGrant {
  return {
    id: text(r.id),
    organisationId: text(r.organisation_id),
    organisationName: text(r.organisation_name),
    staffEmail: text(r.staff_email),
    reason: text(r.reason),
    startedAt: iso(r.started_at),
    expiresAt: iso(r.expires_at),
    endedAt: isoOrNull(r.ended_at),
    active: Boolean(r.active),
    requests: count(r.requests),
  };
}

function memberRole(value: unknown): MemberRole {
  const role = String(value);
  if (!(MEMBER_ROLES as readonly string[]).includes(role)) throw new Error(`Unknown role ${role}`);
  return role as MemberRole;
}

const OperatorParams = z.object({ id: z.uuid() });

export function consoleRoutes(app: FastifyInstance, deps: { scope: RequestScope }) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get('/v1/console/overview', { schema: { response: { 200: ConsoleOverviewSchema } } }, async (req) =>
    deps.scope.asStaff(req, 'console.read', async (tx) => {
      const [r = {}] = await rows(tx, sql`select * from app.console_overview()`);
      return {
        operators: count(r.operators),
        operatorsLive: count(r.operators_live),
        properties: count(r.properties),
        propertiesOnV01: count(r.properties_on_v01),
        propertiesOnGuesty: count(r.properties_on_guesty),
        arrivalsToday: count(r.arrivals_today),
        departuresToday: count(r.departures_today),
        bookingsLast7Days: count(r.bookings_last_7_days),
        outboxWaiting: count(r.outbox_waiting),
        outboxFailed: count(r.outbox_failed),
        webhooksWaiting: count(r.webhooks_waiting),
        webhooksFailed: count(r.webhooks_failed),
        supportSessionsActive: count(r.support_sessions_active),
        lastSentAt: isoOrNull(r.last_sent_at),
        generatedAt: new Date().toISOString(),
      };
    }),
  );

  typed.get(
    '/v1/console/operators',
    { schema: { response: { 200: ConsoleOperatorListSchema } } },
    async (req) =>
      deps.scope.asStaff(req, 'console.read', async (tx) => ({
        operators: (await rows(tx, sql`select * from app.console_operators()`)).map(toOperator),
      })),
  );

  typed.get(
    '/v1/console/operators/:id',
    { schema: { params: OperatorParams, response: { 200: ConsoleOperatorDetailSchema } } },
    async (req) =>
      deps.scope.asStaff(req, 'console.read', async (tx, ctx) => {
        const id = req.params.id;
        const [r] = await rows(tx, sql`select * from app.console_operator(${id}::uuid)`);
        if (!r) throw new HttpError(404, 'operator_not_found', 'There is no operator with that id.');
        const team = canPlatform(ctx.role, 'console.team.read')
          ? (await rows(tx, sql`select * from app.console_operator_team(${id}::uuid)`)).map((m) => ({
              email: text(m.email),
              fullName: textOrNull(m.full_name),
              role: memberRole(m.role),
              status: m.status === 'invited' ? ('invited' as const) : ('active' as const),
              since: iso(m.since),
              lastSeenAt: isoOrNull(m.last_seen_at),
            }))
          : null;
        const support = (await rows(tx, sql`select * from app.console_support_log(${id}::uuid, 20)`)).map(
          toGrant,
        );
        return {
          operator: {
            ...toOperator(r),
            legalName: textOrNull(r.legal_name),
            displayName: textOrNull(r.display_name),
            currency: textOrNull(r.currency),
            timeZone: textOrNull(r.time_zone),
            countryCode: textOrNull(r.country_code),
          },
          team,
          support,
        };
      }),
  );

  typed.get('/v1/console/sync', { schema: { response: { 200: ConsoleSyncSchema } } }, async (req) =>
    deps.scope.asStaff(req, 'console.read', async (tx) => {
      const health = await rows(tx, sql`select * from app.console_sync_health()`);
      const errors = await rows(tx, sql`select * from app.console_sync_errors(50)`);
      return {
        rows: health
          .map((r) => ({
            organisationId: textOrNull(r.organisation_id),
            organisationName: textOrNull(r.organisation_name),
            outboxWaiting: count(r.outbox_waiting),
            outboxFailed: count(r.outbox_failed),
            oldestWaitingAt: isoOrNull(r.oldest_waiting_at),
            lastSentAt: isoOrNull(r.last_sent_at),
            webhooksWaiting: count(r.webhooks_waiting),
            webhooksFailed: count(r.webhooks_failed),
            lastWebhookAt: isoOrNull(r.last_webhook_at),
          }))
          // The "not matched to an operator" row only matters when something is waiting there.
          .filter((r) => r.organisationId !== null || r.webhooksWaiting > 0 || r.webhooksFailed > 0),
        errors: errors.map((e) => ({
          source: e.source === 'webhook' ? ('webhook' as const) : ('outbox' as const),
          organisationId: textOrNull(e.organisation_id),
          organisationName: textOrNull(e.organisation_name),
          at: iso(e.at),
          attempts: count(e.attempts),
          message: text(e.message),
        })),
        generatedAt: new Date().toISOString(),
      };
    }),
  );

  typed.get('/v1/console/support', { schema: { response: { 200: SupportGrantListSchema } } }, async (req) =>
    deps.scope.asStaff(req, 'console.read', async (tx) => ({
      grants: (await rows(tx, sql`select * from app.console_support_log(null, 200)`)).map(toGrant),
    })),
  );

  typed.post(
    '/v1/console/operators/:id/support-access',
    {
      schema: {
        params: OperatorParams,
        body: SupportAccessStartSchema,
        response: { 201: SupportGrantSchema },
      },
    },
    async (req, reply) =>
      deps.scope.asStaff(req, 'support.open', async (tx) => {
        const id = req.params.id;
        let grantId: string;
        try {
          const [started] = await rows(
            tx,
            sql`select app.console_start_support_access(${id}::uuid, ${req.body.reason}, ${req.body.minutes}) as id`,
          );
          grantId = text(started?.id);
        } catch (error) {
          const code = pgErrorCode(error);
          if (code === 'P0002')
            throw new HttpError(404, 'operator_not_found', 'There is no operator with that id.');
          if (code === '22023' || code === '23514') {
            throw new HttpError(
              400,
              'invalid_request',
              'Give a reason, and a time between 5 minutes and 4 hours.',
            );
          }
          throw error;
        }
        const grant = (await rows(tx, sql`select * from app.console_support_log(${id}::uuid, 50)`))
          .map(toGrant)
          .find((g) => g.id === grantId);
        if (!grant) throw new Error('The new support grant could not be read back');
        reply.code(201);
        return grant;
      }),
  );

  typed.post(
    '/v1/console/support-access/:id/end',
    { schema: { params: OperatorParams, response: { 200: z.object({ ended: z.boolean() }) } } },
    async (req) =>
      deps.scope.asStaff(req, 'support.open', async (tx) => {
        const [r] = await rows(
          tx,
          sql`select app.console_end_support_access(${req.params.id}::uuid) as ended`,
        );
        return { ended: Boolean(r?.ended) };
      }),
  );
}
