import {
  ariOutbox,
  channelAccountListings,
  channelAccounts,
  channelListings,
  channexChannels,
  channexMappings,
  properties,
  reservations,
  syncLog,
  type Tx,
} from '@v01/db';
import {
  type AccountListingList,
  AccountListingListSchema,
  CHANNEL_LABELS,
  type ChannelAccount,
  ChannelAccountConnectSchema,
  ChannelAccountCreateSchema,
  type ChannelAccountList,
  ChannelAccountListSchema,
  ChannelAccountSchema,
  listingUrl,
  type PropertyLink,
  PropertyLinkCreateSchema,
  type PropertyLinkList,
  PropertyLinkListSchema,
  type WorkspaceSync,
  WorkspaceSyncSchema,
} from '@v01/shared';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { pgConstraint, type RequestScope, toIso } from '../context.ts';
import { HttpError } from '../errors.ts';

const AccountParams = z.object({ id: z.uuid() });
const PropertyParams = z.object({ id: z.uuid() });
const LinkParams = z.object({ id: z.uuid(), linkId: z.uuid() });

const NOT_FOUND = () =>
  new HttpError(404, 'account_not_found', 'That channel account does not exist in this workspace.');

/** One account with its Channex connection and listing counts. */
async function accountsOf(tx: Tx, id?: string): Promise<ChannelAccount[]> {
  const rows = await tx
    .select({
      id: channelAccounts.id,
      channel: channelAccounts.channel,
      label: channelAccounts.label,
      status: channelAccounts.status,
      loginHolder: channelAccounts.loginHolder,
      twoFactorHolder: channelAccounts.twoFactorHolder,
      externalAccountId: channelAccounts.externalAccountId,
      lastError: channelAccounts.lastError,
      createdAt: channelAccounts.createdAt,
      channexChannelId: channexChannels.channexChannelId,
      connectUrl: channexChannels.connectUrl,
      active: channexChannels.active,
      lastCheckedAt: channexChannels.lastCheckedAt,
      listingsSeen: sql<number>`(select count(*)::int from ${channelAccountListings} l where l.channel_account_id = ${channelAccounts.id})`,
      listingsLinked: sql<number>`(select count(*)::int from ${channelListings} cl where cl.channel_account_id = ${channelAccounts.id} and cl.status in ('linking', 'live'))`,
    })
    .from(channelAccounts)
    .leftJoin(channexChannels, eq(channexChannels.channelAccountId, channelAccounts.id))
    .where(id ? eq(channelAccounts.id, id) : undefined)
    .orderBy(asc(channelAccounts.channel), asc(channelAccounts.label));
  return rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    label: r.label,
    status: r.status,
    loginHolder: r.loginHolder,
    twoFactorHolder: r.twoFactorHolder,
    connection: r.channexChannelId
      ? {
          channexChannelId: r.channexChannelId,
          connectUrl: r.connectUrl,
          active: r.active ?? false,
          externalAccountId: r.externalAccountId,
          lastCheckedAt: r.lastCheckedAt ? toIso(r.lastCheckedAt) : null,
          lastError: r.lastError,
        }
      : r.status === 'pending' || r.status === 'error'
        ? {
            channexChannelId: null,
            connectUrl: null,
            active: false,
            externalAccountId: r.externalAccountId,
            lastCheckedAt: null,
            lastError: r.lastError,
          }
        : null,
    listingsSeen: r.listingsSeen,
    listingsLinked: r.listingsLinked,
    createdAt: toIso(r.createdAt),
  }));
}

/** A property's links on every channel, newest first within a channel, archived ones last. */
export async function linksOf(tx: Tx, propertyId: string): Promise<PropertyLink[]> {
  const rows = await tx
    .select({
      id: channelListings.id,
      channel: channelListings.channel,
      channelAccountId: channelListings.channelAccountId,
      account: channelAccounts.label,
      externalListingId: channelListings.externalListingId,
      status: channelListings.status,
      liveFrom: channelListings.liveFrom,
      lastError: channelListings.lastError,
      requestedBy: sql<
        string | null
      >`(select coalesce(u.full_name, u.email) from app.app_users u where u.id = ${channelListings.requestedBy})`,
      publishedWanted: channelListings.publishedWanted,
      published: channelListings.published,
      settingsSyncedAt: channelListings.settingsSyncedAt,
      settingsError: channelListings.settingsError,
      title: channelAccountListings.title,
      url: channelAccountListings.url,
    })
    .from(channelListings)
    .innerJoin(channelAccounts, eq(channelAccounts.id, channelListings.channelAccountId))
    .leftJoin(
      channelAccountListings,
      and(
        eq(channelAccountListings.channelAccountId, channelListings.channelAccountId),
        eq(channelAccountListings.externalListingId, channelListings.externalListingId),
      ),
    )
    .where(
      and(
        eq(channelListings.propertyId, propertyId),
        inArray(channelListings.status, ['linking', 'live', 'closing']),
      ),
    )
    .orderBy(asc(channelListings.channel), desc(channelListings.createdAt));
  return rows.map((r) => ({
    ...r,
    url: r.url ?? listingUrl(r.channel, r.externalListingId),
    settingsSyncedAt: r.settingsSyncedAt ? toIso(r.settingsSyncedAt) : null,
  }));
}

/**
 * Channel accounts and listing links. Admins add accounts and ask for connections; the worker
 * makes them in Channex. Anyone who edits properties links a listing from a property's page; the
 * worker sends the mapping. Reading is open to everyone who can read properties.
 */
export function channelRoutes(app: FastifyInstance, deps: { scope: RequestScope }) {
  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/v1/channel-accounts',
    { schema: { response: { 200: ChannelAccountListSchema } } },
    async (req) =>
      deps.scope.inOrg(
        req,
        'channels.read',
        async (tx): Promise<ChannelAccountList> => ({ accounts: await accountsOf(tx) }),
      ),
  );

  typed.post(
    '/v1/channel-accounts',
    { schema: { body: ChannelAccountCreateSchema, response: { 201: ChannelAccountSchema } } },
    async (req, reply) =>
      deps.scope.inOrg(req, 'channels.manage', async (tx, ctx) => {
        try {
          const [row] = await tx
            .insert(channelAccounts)
            .values({
              organisationId: ctx.orgId,
              channel: req.body.channel,
              label: req.body.label,
              loginHolder: req.body.loginHolder || null,
              twoFactorHolder: req.body.twoFactorHolder || null,
              status: 'disconnected',
            })
            .returning({ id: channelAccounts.id });
          const [account] = await accountsOf(tx, row?.id);
          if (!account) throw new Error('insert returned nothing');
          reply.code(201);
          return account;
        } catch (error) {
          if (pgConstraint(error) === 'channel_accounts_org_label_key') {
            throw new HttpError(
              409,
              'account_exists',
              `There is already an account called "${req.body.label}".`,
            );
          }
          throw error;
        }
      }),
  );

  // Asks the worker to make the connection in Channex. Booking.com needs its hotel id first.
  typed.post(
    '/v1/channel-accounts/:id/connect',
    {
      schema: {
        params: AccountParams,
        body: ChannelAccountConnectSchema,
        response: { 200: ChannelAccountSchema },
      },
    },
    async (req) =>
      deps.scope.inOrg(req, 'channels.manage', async (tx) => {
        const [current] = await accountsOf(tx, req.params.id);
        if (!current) throw NOT_FOUND();
        if (current.status === 'connected') {
          throw new HttpError(409, 'already_connected', `${current.label} is already connected.`);
        }
        if (
          current.channel === 'booking_com' &&
          !req.body.hotelId &&
          !current.connection?.externalAccountId
        ) {
          throw new HttpError(
            422,
            'hotel_id_required',
            "Booking.com needs the account's hotel id to connect.",
          );
        }
        const [mapped] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(channexMappings)
          .innerJoin(properties, eq(properties.id, channexMappings.propertyId))
          .where(isNull(properties.archivedAt));
        if (!mapped?.n) {
          throw new HttpError(
            409,
            'no_properties_connected',
            'Connect at least one property to Channex first.',
          );
        }
        await tx
          .update(channelAccounts)
          .set({
            status: 'pending',
            lastError: null,
            ...(req.body.hotelId ? { externalAccountId: req.body.hotelId } : {}),
          })
          .where(eq(channelAccounts.id, req.params.id));
        const [account] = await accountsOf(tx, req.params.id);
        return account as ChannelAccount;
      }),
  );

  typed.get(
    '/v1/channel-accounts/:id/listings',
    { schema: { params: AccountParams, response: { 200: AccountListingListSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'channels.read', async (tx): Promise<AccountListingList> => {
        const [account] = await accountsOf(tx, req.params.id);
        if (!account) throw NOT_FOUND();
        const rows = await tx
          .select({
            externalListingId: channelAccountListings.externalListingId,
            title: channelAccountListings.title,
            url: channelAccountListings.url,
            seenAt: channelAccountListings.seenAt,
            linkedPropertyId: channelListings.propertyId,
            linkedPropertyName: properties.name,
          })
          .from(channelAccountListings)
          .leftJoin(
            channelListings,
            and(
              eq(channelListings.channelAccountId, channelAccountListings.channelAccountId),
              eq(channelListings.externalListingId, channelAccountListings.externalListingId),
              inArray(channelListings.status, ['linking', 'live']),
            ),
          )
          .leftJoin(properties, eq(properties.id, channelListings.propertyId))
          .where(eq(channelAccountListings.channelAccountId, req.params.id))
          .orderBy(asc(channelAccountListings.title), asc(channelAccountListings.externalListingId));
        return {
          listings: rows.map((r) => ({
            externalListingId: r.externalListingId,
            title: r.title,
            url: r.url ?? listingUrl(account.channel, r.externalListingId),
            linkedPropertyId: r.linkedPropertyId,
            linkedPropertyName: r.linkedPropertyName,
            seenAt: toIso(r.seenAt),
          })),
        };
      }),
  );

  typed.get(
    '/v1/properties/:id/links',
    { schema: { params: PropertyParams, response: { 200: PropertyLinkListSchema } } },
    async (req) =>
      deps.scope.inOrg(
        req,
        'channels.read',
        async (tx): Promise<PropertyLinkList> => ({ links: await linksOf(tx, req.params.id) }),
      ),
  );

  // Links a listing: the row is `linking` until the worker has sent the mapping to Channex.
  typed.post(
    '/v1/properties/:id/links',
    {
      schema: {
        params: PropertyParams,
        body: PropertyLinkCreateSchema,
        response: { 201: PropertyLinkListSchema },
      },
    },
    async (req, reply) =>
      deps.scope.inOrg(req, 'properties.write', async (tx, ctx) => {
        const [property] = await tx
          .select({ id: properties.id })
          .from(properties)
          .where(and(eq(properties.id, req.params.id), isNull(properties.archivedAt)));
        if (!property)
          throw new HttpError(404, 'property_not_found', 'That property does not exist in this workspace.');
        const [account] = await accountsOf(tx, req.body.channelAccountId);
        if (!account) throw NOT_FOUND();
        if (account.status !== 'connected') {
          throw new HttpError(409, 'account_not_connected', `${account.label} isn't connected yet.`);
        }
        const [mapping] = await tx
          .select({ id: channexMappings.id })
          .from(channexMappings)
          .where(eq(channexMappings.propertyId, property.id));
        if (!mapping)
          throw new HttpError(409, 'property_not_connected', 'Connect the property to Channex first.');
        const [onChannel] = await tx
          .select({ id: channelListings.id })
          .from(channelListings)
          .where(
            and(
              eq(channelListings.propertyId, property.id),
              eq(channelListings.channel, account.channel),
              inArray(channelListings.status, ['linking', 'live']),
            ),
          );
        if (onChannel) {
          throw new HttpError(
            409,
            'channel_taken',
            `This property already has a ${CHANNEL_LABELS[account.channel]} listing linked. Unlink it first.`,
          );
        }
        const [taken] = await tx
          .select({ propertyName: properties.name })
          .from(channelListings)
          .innerJoin(properties, eq(properties.id, channelListings.propertyId))
          .where(
            and(
              eq(channelListings.channelAccountId, account.id),
              eq(channelListings.externalListingId, req.body.externalListingId),
              inArray(channelListings.status, ['linking', 'live', 'closing']),
            ),
          );
        if (taken) {
          throw new HttpError(
            409,
            'listing_taken',
            `That listing is already linked to ${taken.propertyName}.`,
          );
        }
        try {
          await tx.insert(channelListings).values({
            organisationId: ctx.orgId,
            propertyId: property.id,
            channelAccountId: account.id,
            channel: account.channel,
            externalListingId: req.body.externalListingId,
            status: 'linking',
            requestedBy: ctx.userId,
          });
        } catch (error) {
          if (pgConstraint(error) === 'channel_listings_one_live_per_channel') {
            throw new HttpError(
              409,
              'channel_taken',
              `This property already has a live ${CHANNEL_LABELS[account.channel]} listing.`,
            );
          }
          throw error;
        }
        reply.code(201);
        return { links: await linksOf(tx, property.id) };
      }),
  );

  // Unlinks: `closing` until the worker has taken the mapping out of Channex.
  typed.delete(
    '/v1/properties/:id/links/:linkId',
    { schema: { params: LinkParams, response: { 200: PropertyLinkListSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'properties.write', async (tx) => {
        const rows = await tx
          .update(channelListings)
          .set({ status: 'closing', lastError: null })
          .where(
            and(
              eq(channelListings.id, req.params.linkId),
              eq(channelListings.propertyId, req.params.id),
              inArray(channelListings.status, ['linking', 'live']),
            ),
          )
          .returning({ id: channelListings.id });
        if (!rows.length)
          throw new HttpError(404, 'link_not_found', 'That link does not exist, or is already gone.');
        return { links: await linksOf(tx, req.params.id) };
      }),
  );

  // Airbnb only: pause takes the listing off Airbnb (the worker asks Channex); resume puts it back.
  const PauseParams = LinkParams.extend({ action: z.enum(['pause', 'resume']) });
  typed.post(
    '/v1/properties/:id/links/:linkId/:action',
    { schema: { params: PauseParams, response: { 200: PropertyLinkListSchema } } },
    async (req) =>
      deps.scope.inOrg(req, 'properties.write', async (tx) => {
        const [link] = await tx
          .select({
            id: channelListings.id,
            channel: channelListings.channel,
            status: channelListings.status,
          })
          .from(channelListings)
          .where(
            and(eq(channelListings.id, req.params.linkId), eq(channelListings.propertyId, req.params.id)),
          );
        if (link?.status !== 'live') throw new HttpError(404, 'link_not_found', 'That link is not live.');
        if (link.channel !== 'airbnb') {
          throw new HttpError(
            409,
            'not_on_this_channel',
            `${CHANNEL_LABELS[link.channel]} listings are paused on ${CHANNEL_LABELS[link.channel]} itself for now.`,
          );
        }
        await tx
          .update(channelListings)
          .set({ publishedWanted: req.params.action === 'resume', lastError: null })
          .where(eq(channelListings.id, link.id));
        return { links: await linksOf(tx, req.params.id) };
      }),
  );

  // The workspace's own sync picture, from its own tables.
  typed.get('/v1/channels/sync', { schema: { response: { 200: WorkspaceSyncSchema } } }, async (req) =>
    deps.scope.inOrg(req, 'channels.read', async (tx): Promise<WorkspaceSync> => {
      const [outbox] = await tx
        .select({
          waiting: sql<number>`(count(*) filter (where ${ariOutbox.status} in ('pending', 'sending')))::int`,
          failed: sql<number>`(count(*) filter (where ${ariOutbox.status} = 'failed'))::int`,
          oldestWaitingAt: sql<
            string | null
          >`min(${ariOutbox.createdAt}) filter (where ${ariOutbox.status} in ('pending', 'sending'))`,
          lastSentAt: sql<string | null>`max(${ariOutbox.sentAt})`,
        })
        .from(ariOutbox);
      const [booking] = await tx
        .select({ at: sql<string | null>`max(${reservations.createdAt})` })
        .from(reservations);
      const [checks] = await tx
        .select({
          lastCheckedAt: sql<string | null>`max(${channexMappings.crossCheckedAt})`,
          properties: sql<number>`count(*)::int`,
          matching: sql<number>`(count(*) filter (where ${channexMappings.crossCheckDifferences} = 0))::int`,
          differing: sql<number>`(count(*) filter (where ${channexMappings.crossCheckDifferences} > 0))::int`,
          failed: sql<number>`(count(*) filter (where ${channexMappings.crossCheckError} is not null))::int`,
          unchecked: sql<number>`(count(*) filter (where ${channexMappings.crossCheckedAt} is null))::int`,
        })
        .from(channexMappings)
        .innerJoin(properties, eq(properties.id, channexMappings.propertyId))
        .where(and(eq(properties.managedBy, 'v01'), isNull(properties.archivedAt)));
      const recent = await tx
        .select({
          id: syncLog.id,
          at: syncLog.createdAt,
          propertyName: properties.name,
          direction: syncLog.direction,
          kind: syncLog.kind,
          status: syncLog.status,
          detail: syncLog.detail,
        })
        .from(syncLog)
        .leftJoin(properties, eq(properties.id, syncLog.propertyId))
        .orderBy(desc(syncLog.id))
        .limit(30);
      return {
        outboxWaiting: outbox?.waiting ?? 0,
        outboxFailed: outbox?.failed ?? 0,
        oldestWaitingAt: outbox?.oldestWaitingAt ? toIso(outbox.oldestWaitingAt) : null,
        lastSentAt: outbox?.lastSentAt ? toIso(outbox.lastSentAt) : null,
        lastBookingAt: booking?.at ? toIso(booking.at) : null,
        crossCheck: {
          lastCheckedAt: checks?.lastCheckedAt ? toIso(checks.lastCheckedAt) : null,
          properties: checks?.properties ?? 0,
          matching: checks?.matching ?? 0,
          differing: checks?.differing ?? 0,
          failed: checks?.failed ?? 0,
          unchecked: checks?.unchecked ?? 0,
        },
        recent: recent.map((r) => {
          const detail = (r.detail ?? {}) as Record<string, unknown>;
          const drift =
            typeof detail.nightsDiffering === 'number' && detail.nightsDiffering > 0
              ? `${detail.nightsDiffering} ${detail.nightsDiffering === 1 ? 'night' : 'nights'} differed, sent again`
              : null;
          const message = [detail.error, detail.account, detail.listing, drift]
            .filter((v): v is string => typeof v === 'string')
            .join(' · ');
          return {
            id: r.id,
            at: toIso(r.at),
            propertyName: r.propertyName,
            direction: r.direction,
            kind: r.kind,
            status: r.status,
            message: message || null,
          };
        }),
      };
    }),
  );
}
