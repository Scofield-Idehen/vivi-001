import {
  ariOutbox,
  channelAccounts,
  channelListings,
  channexMappings,
  channexSetups,
  guests,
  messageThreads,
  organisationSettings,
  properties,
  reservations,
} from '@v01/db';
import {
  type AttentionItem,
  CHANNEL_LABELS,
  can,
  type Today,
  TodaySchema,
  type TodayStay,
  todayIn,
} from '@v01/shared';
import { and, asc, eq, gt, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { type RequestScope, toIso } from '../context.ts';

/** The worker reports in every 30 seconds; quiet for this long means nothing is reaching the channels. */
export const WORKER_QUIET_MS = 10 * 60_000;

const nightsBetween = (checkIn: string, checkOut: string) =>
  Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000);

/** "29 Oct" from an ISO date, for the attention list. */
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const day = (date: string) => DAY.format(new Date(`${date}T12:00:00Z`));

/** "15:00" from Postgres's "15:00:00". */
const clock = (time: string | null) => (time ? time.slice(0, 5) : null);

/**
 * Today: arrivals, departures, cleans due and everything that needs a person. Each role sees what it
 * may: the field team sees cleans and arrivals without guest names; accounts see no channel problems.
 */
export function todayRoutes(app: FastifyInstance, deps: { scope: RequestScope }) {
  app
    .withTypeProvider<ZodTypeProvider>()
    .get('/v1/today', { schema: { response: { 200: TodaySchema } } }, async (req) =>
      deps.scope.inOrg(req, 'workspace.read', async (tx, ctx): Promise<Today> => {
        const [settings] = await tx
          .select({ timeZone: organisationSettings.timeZone })
          .from(organisationSettings);
        const today = todayIn(settings?.timeZone ?? 'Europe/London');
        const seesGuests = can(ctx.role, 'reservations.read');
        const seesChannels = can(ctx.role, 'channels.read');
        const seesProperties = can(ctx.role, 'properties.read');

        const stayRows = await tx
          .select({
            reservationId: reservations.id,
            propertyId: reservations.propertyId,
            propertyName: properties.name,
            guestName: guests.fullName,
            channel: reservations.channel,
            checkIn: reservations.checkIn,
            checkOut: reservations.checkOut,
            checkInTime: reservations.checkInTime,
            checkOutTime: reservations.checkOutTime,
            adults: reservations.adults,
            children: reservations.children,
          })
          .from(reservations)
          .innerJoin(properties, eq(properties.id, reservations.propertyId))
          .leftJoin(guests, eq(guests.id, reservations.guestId))
          .where(
            and(
              eq(reservations.status, 'confirmed'),
              lte(reservations.checkIn, today),
              // Leaving today or later: in the house tonight, or going today.
              sql`${reservations.checkOut} >= ${today}`,
            ),
          )
          .orderBy(asc(properties.name));
        const stay = (r: (typeof stayRows)[number], time: string | null): TodayStay => ({
          reservationId: r.reservationId,
          propertyId: r.propertyId,
          propertyName: r.propertyName,
          guestName: seesGuests ? r.guestName : null,
          channel: r.channel,
          checkIn: r.checkIn,
          checkOut: r.checkOut,
          nights: nightsBetween(r.checkIn, r.checkOut),
          time: clock(time),
          guests: r.adults + r.children,
        });
        const arrivals = stayRows.filter((r) => r.checkIn === today).map((r) => stay(r, r.checkInTime));
        const departures = stayRows.filter((r) => r.checkOut === today).map((r) => stay(r, r.checkOutTime));
        const staying = stayRows.filter((r) => r.checkOut > today).length;

        const dirty = seesProperties
          ? await tx
              .select({
                propertyId: properties.id,
                propertyName: properties.name,
                since: properties.cleaningChangedAt,
              })
              .from(properties)
              .where(and(eq(properties.cleaningStatus, 'dirty'), isNull(properties.archivedAt)))
              .orderBy(asc(properties.name))
          : [];

        const attention: AttentionItem[] = [];

        if (seesGuests) {
          const conflicts = await tx
            .select({
              id: reservations.id,
              propertyId: reservations.propertyId,
              propertyName: properties.name,
              checkIn: reservations.checkIn,
              checkOut: reservations.checkOut,
              channel: reservations.channel,
            })
            .from(reservations)
            .innerJoin(properties, eq(properties.id, reservations.propertyId))
            .where(and(eq(reservations.status, 'conflict'), sql`${reservations.checkOut} >= ${today}`))
            .orderBy(asc(reservations.checkIn));
          for (const c of conflicts) {
            attention.push({
              id: `conflict:${c.id}`,
              severity: 'urgent',
              title: `Two bookings overlap at ${c.propertyName}`,
              detail: `A ${CHANNEL_LABELS[c.channel]} booking for ${day(c.checkIn)} to ${day(c.checkOut)} clashes with another stay. One guest has to be moved or refunded.`,
              to: `/reservations/${c.id}`,
            });
          }
        }

        const [workerSeen] = (
          await tx.execute<{ seen: string | null }>(sql`select app.worker_last_seen() as seen`)
        ).rows;
        const workerSeenAt = workerSeen?.seen ? toIso(workerSeen.seen) : null;

        if (seesChannels) {
          const quietFor = workerSeenAt ? Date.now() - Date.parse(workerSeenAt) : null;
          if (quietFor !== null && quietFor > WORKER_QUIET_MS) {
            const minutes = Math.round(quietFor / 60_000);
            attention.push({
              id: 'worker',
              severity: 'urgent',
              title: `Nothing has reached the channels for ${minutes} minutes`,
              detail:
                'V-01’s sync worker has not reported in. Channex keeps closing booked nights itself meanwhile, so nothing is sold twice; prices and new blocks wait until it is back.',
              to: '/channels',
            });
          }

          const [failed] = await tx
            .select({
              n: sql<number>`count(*)::int`,
              propertyNames: sql<
                string[]
              >`array_agg(distinct ${properties.name} order by ${properties.name})`,
            })
            .from(ariOutbox)
            .innerJoin(properties, eq(properties.id, ariOutbox.propertyId))
            .where(eq(ariOutbox.status, 'failed'));
          if (failed && failed.n > 0) {
            attention.push({
              id: 'outbox-failed',
              severity: 'urgent',
              title: `${failed.n} ${failed.n === 1 ? 'change' : 'changes'} didn’t reach the channels`,
              detail: `Channex refused them for ${failed.propertyNames.join(', ')}. The calendar on the channels may be out of date until they go.`,
              to: '/channels',
            });
          }

          const drift = await tx
            .select({
              propertyId: channexMappings.propertyId,
              propertyName: properties.name,
              differences: channexMappings.crossCheckDifferences,
              error: channexMappings.crossCheckError,
              checkedAt: channexMappings.crossCheckedAt,
            })
            .from(channexMappings)
            .innerJoin(properties, eq(properties.id, channexMappings.propertyId))
            .where(
              and(
                eq(properties.managedBy, 'v01'),
                isNull(properties.archivedAt),
                or(gt(channexMappings.crossCheckDifferences, 0), isNotNull(channexMappings.crossCheckError)),
              ),
            )
            .orderBy(asc(properties.name));
          for (const d of drift) {
            attention.push(
              d.error
                ? {
                    id: `cross-check-failed:${d.propertyId}`,
                    severity: 'warning',
                    title: `Couldn’t check ${d.propertyName} against Channex`,
                    detail: `${d.error} The worker tries again tonight.`,
                    to: `/properties/${d.propertyId}`,
                  }
                : {
                    id: `cross-check:${d.propertyId}`,
                    severity: 'warning',
                    title: `Channex didn’t match ${d.propertyName}`,
                    detail: `${d.differences} ${d.differences === 1 ? 'night' : 'nights'} differed in last night’s check and ${d.differences === 1 ? 'was' : 'were'} sent again. If it happens again tomorrow, someone is changing things in Channex or on the channel.`,
                    to: `/properties/${d.propertyId}`,
                  },
            );
          }

          const autoCloseOff = await tx
            .select({ propertyId: channexMappings.propertyId, propertyName: properties.name })
            .from(channexMappings)
            .innerJoin(properties, eq(properties.id, channexMappings.propertyId))
            .where(and(eq(channexMappings.autoClose, false), isNull(properties.archivedAt)));
          for (const p of autoCloseOff) {
            attention.push({
              id: `auto-close:${p.propertyId}`,
              severity: 'urgent',
              title: `Channex had stopped closing booked nights for ${p.propertyName}`,
              detail:
                'The worker is turning the setting back on. Until it is, a night could be sold twice while V-01 is down.',
              to: `/properties/${p.propertyId}`,
            });
          }

          const accounts = await tx
            .select({
              id: channelAccounts.id,
              label: channelAccounts.label,
              channel: channelAccounts.channel,
              status: channelAccounts.status,
              lastError: channelAccounts.lastError,
            })
            .from(channelAccounts)
            .where(or(eq(channelAccounts.status, 'error'), eq(channelAccounts.status, 'pending')))
            .orderBy(asc(channelAccounts.label));
          for (const a of accounts) {
            attention.push(
              a.status === 'error'
                ? {
                    id: `account:${a.id}`,
                    severity: 'urgent',
                    title: `${a.label} isn’t connected`,
                    detail:
                      a.lastError ??
                      `Channex lost the connection to the ${CHANNEL_LABELS[a.channel]} account.`,
                    to: '/channels',
                  }
                : {
                    id: `account:${a.id}`,
                    severity: 'warning',
                    title: `${a.label} is waiting to be authorised`,
                    detail: `The account’s owner has to open the ${CHANNEL_LABELS[a.channel]} link on Channels & sync.`,
                    to: '/channels',
                  },
            );
          }

          const links = await tx
            .select({
              id: channelListings.id,
              propertyId: channelListings.propertyId,
              propertyName: properties.name,
              channel: channelListings.channel,
              lastError: channelListings.lastError,
              settingsError: channelListings.settingsError,
            })
            .from(channelListings)
            .innerJoin(properties, eq(properties.id, channelListings.propertyId))
            .where(
              and(
                ne(channelListings.status, 'archived'),
                or(isNotNull(channelListings.lastError), isNotNull(channelListings.settingsError)),
              ),
            )
            .orderBy(asc(properties.name));
          for (const l of links) {
            attention.push({
              id: `link:${l.id}`,
              severity: 'warning',
              title: `${CHANNEL_LABELS[l.channel]} listing problem at ${l.propertyName}`,
              detail: l.lastError ?? `Fees and booking rules: ${l.settingsError}`,
              to: `/properties/${l.propertyId}`,
            });
          }

          const setups = await tx
            .select({
              propertyId: channexSetups.propertyId,
              propertyName: properties.name,
              lastError: channexSetups.lastError,
            })
            .from(channexSetups)
            .innerJoin(properties, eq(properties.id, channexSetups.propertyId))
            .where(and(eq(channexSetups.status, 'failed'), isNull(properties.archivedAt)));
          for (const s of setups) {
            attention.push({
              id: `setup:${s.propertyId}`,
              severity: 'warning',
              title: `Couldn’t connect ${s.propertyName} to Channex`,
              detail: s.lastError,
              to: `/properties/${s.propertyId}`,
            });
          }
        }

        // Guests waiting on a reply: a warning after an hour, urgent after a day (the sites' response clocks).
        if (can(ctx.role, 'inbox.read')) {
          const [waiting] = await tx
            .select({
              count: sql<number>`count(*)::int`,
              oldest: sql<string | null>`min(${messageThreads.awaitingSince})`,
            })
            .from(messageThreads)
            .where(isNotNull(messageThreads.awaitingSince));
          if (waiting && waiting.count > 0 && waiting.oldest) {
            const hours = (Date.now() - Date.parse(toIso(waiting.oldest))) / 3_600_000;
            attention.push({
              id: 'inbox:awaiting',
              severity: hours >= 24 ? 'urgent' : 'warning',
              title:
                waiting.count === 1
                  ? 'A guest is waiting for a reply'
                  : `${waiting.count} guests are waiting for a reply`,
              detail:
                hours >= 24
                  ? `The longest for ${Math.floor(hours / 24)} ${Math.floor(hours / 24) === 1 ? 'day' : 'days'}.`
                  : hours >= 1
                    ? `The longest for ${Math.floor(hours)} ${Math.floor(hours) === 1 ? 'hour' : 'hours'}.`
                    : 'Within the hour.',
              to: '/inbox',
            });
          }
        }

        attention.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'urgent' ? -1 : 1));

        return {
          date: today,
          arrivals,
          departures,
          staying,
          cleansDue: dirty.map((d) => ({
            propertyId: d.propertyId,
            propertyName: d.propertyName,
            since: d.since ? toIso(d.since) : null,
          })),
          attention,
          workerSeenAt,
        };
      }),
    );
}
