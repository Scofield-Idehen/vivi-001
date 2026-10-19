import { ChannelError, type ChannelMapping } from '@v01/channels';
import {
  channelAccountListings,
  channelAccounts,
  channelListings,
  channexChannels,
  channexGroups,
  channexMappings,
  properties,
  syncLog,
  type Tx,
} from '@v01/db';
import { listingUrl, todayIn } from '@v01/shared';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { WorkerDeps } from './deps.ts';

/**
 * Listing links (integration step 7): how a property reaches Airbnb, Booking.com and Vrbo.
 *
 * 1. An admin asks to connect a channel account; the worker makes the connection in Channex,
 *    holding the operator's connected properties, and keeps the authorisation link for the
 *    account's owner. It then looks every few minutes until Channex says the connection is active.
 * 2. Once active, the worker reads the listings Channex sees on the account and caches them, so the
 *    property page can offer them without the API talking to Channex.
 * 3. A link asked for on a property page is `linking` until the worker has sent the account's whole
 *    mapping set to Channex (each rate plan to its listing); an unlink is `closing` until it is gone.
 */

export interface LinkStats {
  connected: number;
  activated: number;
  refreshed: number;
  linked: number;
  unlinked: number;
  failed: number;
}

const zero = (): LinkStats => ({
  connected: 0,
  activated: 0,
  refreshed: 0,
  linked: 0,
  unlinked: 0,
  failed: 0,
});

async function log(
  tx: Tx,
  orgId: string,
  propertyId: string | null,
  kind: string,
  status: 'ok' | 'error',
  detail: Record<string, unknown>,
) {
  await tx
    .insert(syncLog)
    .values({ organisationId: orgId, propertyId, direction: 'out', kind, status, detail });
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Accounts an admin asked to connect, with no Channex connection yet. */
async function connectPending(deps: WorkerDeps, orgId: string, stats: LinkStats): Promise<void> {
  const waiting = await deps.db.withOrg({ orgId }, (tx) =>
    tx
      .select({
        id: channelAccounts.id,
        channel: channelAccounts.channel,
        label: channelAccounts.label,
        externalAccountId: channelAccounts.externalAccountId,
      })
      .from(channelAccounts)
      .leftJoin(channexChannels, eq(channexChannels.channelAccountId, channelAccounts.id))
      .where(and(eq(channelAccounts.status, 'pending'), sql`${channexChannels.id} is null`)),
  );
  for (const account of waiting) {
    if (account.channel !== 'airbnb' && account.channel !== 'booking_com' && account.channel !== 'vrbo')
      continue;
    const channel = account.channel;
    const context = await deps.db.withOrg({ orgId }, async (tx) => {
      const [group] = await tx.select({ id: channexGroups.channexGroupId }).from(channexGroups);
      const mapped = await tx
        .select({ channexPropertyId: channexMappings.channexPropertyId })
        .from(channexMappings)
        .innerJoin(properties, eq(properties.id, channexMappings.propertyId))
        .where(sql`${properties.archivedAt} is null`);
      return { groupId: group?.id ?? null, externalPropertyIds: mapped.map((m) => m.channexPropertyId) };
    });
    if (!context.groupId || context.externalPropertyIds.length === 0) {
      await deps.db.withOrg({ orgId }, (tx) =>
        tx
          .update(channelAccounts)
          .set({ status: 'error', lastError: 'Connect at least one property to Channex first.' })
          .where(eq(channelAccounts.id, account.id)),
      );
      stats.failed += 1;
      continue;
    }
    try {
      const ref = await deps.provider.createChannel({
        channel,
        title: account.label,
        groupId: context.groupId,
        externalPropertyIds: context.externalPropertyIds,
        ...(channel === 'booking_com' && account.externalAccountId
          ? { hotelId: account.externalAccountId }
          : {}),
      });
      await deps.db.withOrg({ orgId }, async (tx) => {
        await tx.insert(channexChannels).values({
          organisationId: orgId,
          channelAccountId: account.id,
          channexChannelId: ref.channelId,
          connectUrl: ref.connectUrl,
        });
        await tx.update(channelAccounts).set({ lastError: null }).where(eq(channelAccounts.id, account.id));
        await log(tx, orgId, null, 'channel', 'ok', {
          account: account.label,
          channel,
          channelId: ref.channelId,
        });
      });
      stats.connected += 1;
    } catch (error) {
      const message = messageOf(error);
      const permanent = !(error instanceof ChannelError && error.retryable);
      await deps.db.withOrg({ orgId }, async (tx) => {
        await tx
          .update(channelAccounts)
          .set({ lastError: message, ...(permanent ? { status: 'error' as const } : {}) })
          .where(eq(channelAccounts.id, account.id));
        await log(tx, orgId, null, 'channel', 'error', { account: account.label, channel, error: message });
      });
      if (permanent) {
        await deps.alerts.send({
          severity: 'warning',
          title: `Couldn't connect ${account.label} to Channex`,
          detail: message,
        });
      }
      stats.failed += 1;
      if (!(error instanceof ChannelError)) throw error;
    }
  }
}

/** Replaces the cached listings for one account with what Channex sees now. */
async function refreshListings(
  deps: WorkerDeps,
  orgId: string,
  accountId: string,
  channelId: string,
): Promise<void> {
  const now = (deps.now?.() ?? new Date()).toISOString();
  const [account] = await deps.db.withOrg({ orgId }, (tx) =>
    tx
      .select({ channel: channelAccounts.channel })
      .from(channelAccounts)
      .where(eq(channelAccounts.id, accountId)),
  );
  const seen = await deps.provider.listChannelListings(channelId);
  await deps.db.withOrg({ orgId }, async (tx) => {
    for (const listing of seen) {
      await tx
        .insert(channelAccountListings)
        .values({
          organisationId: orgId,
          channelAccountId: accountId,
          externalListingId: listing.externalListingId,
          title: listing.title,
          url: listing.url ?? (account ? listingUrl(account.channel, listing.externalListingId) : null),
          seenAt: now,
        })
        .onConflictDoUpdate({
          target: [channelAccountListings.channelAccountId, channelAccountListings.externalListingId],
          set: { title: listing.title, url: listing.url ?? sql`${channelAccountListings.url}`, seenAt: now },
        });
    }
    const ids = seen.map((l) => l.externalListingId);
    await tx
      .delete(channelAccountListings)
      .where(
        and(
          eq(channelAccountListings.channelAccountId, accountId),
          ids.length ? notInArray(channelAccountListings.externalListingId, ids) : sql`true`,
        ),
      );
  });
}

/** Pending connections: has the owner authorised yet? Connected ones: refresh the listings. */
async function checkConnections(
  deps: WorkerDeps,
  orgId: string,
  stats: LinkStats,
  refreshAll: boolean,
): Promise<void> {
  const now = (deps.now?.() ?? new Date()).toISOString();
  const rows = await deps.db.withOrg({ orgId }, (tx) =>
    tx
      .select({
        accountId: channelAccounts.id,
        label: channelAccounts.label,
        status: channelAccounts.status,
        channelId: channexChannels.channexChannelId,
        active: channexChannels.active,
      })
      .from(channelAccounts)
      .innerJoin(channexChannels, eq(channexChannels.channelAccountId, channelAccounts.id))
      .where(inArray(channelAccounts.status, ['pending', 'connected'])),
  );
  for (const row of rows) {
    try {
      if (row.status === 'pending') {
        const state = await deps.provider.getChannelState(row.channelId);
        await deps.db.withOrg({ orgId }, async (tx) => {
          await tx
            .update(channexChannels)
            .set({ active: state.active, lastCheckedAt: now })
            .where(eq(channexChannels.channexChannelId, row.channelId));
          if (state.active) {
            await tx
              .update(channelAccounts)
              .set({
                status: 'connected',
                lastError: null,
                ...(state.externalAccountId ? { externalAccountId: state.externalAccountId } : {}),
              })
              .where(eq(channelAccounts.id, row.accountId));
            await log(tx, orgId, null, 'channel', 'ok', { account: row.label, activated: true });
          }
        });
        if (!state.active) continue;
        stats.activated += 1;
        await refreshListings(deps, orgId, row.accountId, row.channelId);
        stats.refreshed += 1;
      } else if (refreshAll) {
        await refreshListings(deps, orgId, row.accountId, row.channelId);
        stats.refreshed += 1;
      }
    } catch (error) {
      const message = messageOf(error);
      await deps.db.withOrg({ orgId }, (tx) =>
        tx.update(channelAccounts).set({ lastError: message }).where(eq(channelAccounts.id, row.accountId)),
      );
      deps.log.warn({ orgId, account: row.label, error: message }, "Couldn't check the channel connection");
      stats.failed += 1;
      if (!(error instanceof ChannelError)) throw error;
    }
  }
}

/** Links waiting to be mapped or unmapped, sent to Channex as each account's whole mapping set. */
async function syncLinks(deps: WorkerDeps, orgId: string, stats: LinkStats): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const pending = await deps.db.withOrg({ orgId }, (tx) =>
    tx
      .select({ accountId: channelListings.channelAccountId })
      .from(channelListings)
      .where(inArray(channelListings.status, ['linking', 'closing']))
      .groupBy(channelListings.channelAccountId),
  );
  for (const { accountId } of pending) {
    const picture = await deps.db.withOrg({ orgId }, async (tx) => {
      const [account] = await tx
        .select({
          label: channelAccounts.label,
          status: channelAccounts.status,
          channelId: channexChannels.channexChannelId,
          active: channexChannels.active,
          timeZone: sql<string>`coalesce((select time_zone from app.organisation_settings limit 1), 'Europe/London')`,
        })
        .from(channelAccounts)
        .leftJoin(channexChannels, eq(channexChannels.channelAccountId, channelAccounts.id))
        .where(eq(channelAccounts.id, accountId));
      const links = await tx
        .select({
          id: channelListings.id,
          propertyId: channelListings.propertyId,
          externalListingId: channelListings.externalListingId,
          status: channelListings.status,
          ratePlanId: channexMappings.channexRatePlanId,
        })
        .from(channelListings)
        .leftJoin(channexMappings, eq(channexMappings.propertyId, channelListings.propertyId))
        .where(
          and(
            eq(channelListings.channelAccountId, accountId),
            inArray(channelListings.status, ['linking', 'live', 'closing']),
          ),
        );
      return { account, links };
    });
    const { account, links } = picture;
    const waiting = links.filter((l) => l.status !== 'live');
    if (!account?.channelId || account.status !== 'connected') {
      const why = account?.channelId
        ? `${account.label} isn't connected yet; the account's owner has to authorise it.`
        : `${account?.label ?? 'The account'} has no Channex connection yet.`;
      await deps.db.withOrg({ orgId }, (tx) =>
        tx
          .update(channelListings)
          .set({ lastError: why })
          .where(
            inArray(
              channelListings.id,
              waiting.map((l) => l.id),
            ),
          ),
      );
      stats.failed += waiting.length;
      continue;
    }
    const unmapped = links.filter((l) => l.status !== 'closing' && !l.ratePlanId);
    if (unmapped.length) {
      await deps.db.withOrg({ orgId }, (tx) =>
        tx
          .update(channelListings)
          .set({ lastError: 'Connect the property to Channex first.' })
          .where(
            inArray(
              channelListings.id,
              unmapped.map((l) => l.id),
            ),
          ),
      );
      stats.failed += unmapped.length;
    }
    const mappings: ChannelMapping[] = links
      .filter((l) => l.status !== 'closing' && l.ratePlanId)
      .map((l) => ({ ratePlanId: l.ratePlanId as string, externalListingId: l.externalListingId }));
    try {
      const refs = await deps.provider.setChannelMappings(account.channelId, mappings);
      const mappingIdOf = (listingId: string) =>
        refs.find((r) => r.externalListingId === listingId)?.mappingId ?? null;
      if (!account.active && mappings.length) {
        await deps.provider.activateChannel(account.channelId);
      }
      const today = todayIn(account.timeZone, now);
      await deps.db.withOrg({ orgId }, async (tx) => {
        for (const link of waiting) {
          if (link.status === 'closing') {
            await tx
              .update(channelListings)
              .set({ status: 'archived', closedAt: now.toISOString(), lastError: null })
              .where(eq(channelListings.id, link.id));
            await log(tx, orgId, link.propertyId, 'link', 'ok', {
              account: account.label,
              listing: link.externalListingId,
              unlinked: true,
            });
            stats.unlinked += 1;
          } else if (link.ratePlanId) {
            await tx
              .update(channelListings)
              .set({
                status: 'live',
                liveFrom: today,
                lastError: null,
                channexMappingId: mappingIdOf(link.externalListingId),
              })
              .where(eq(channelListings.id, link.id));
            await log(tx, orgId, link.propertyId, 'link', 'ok', {
              account: account.label,
              listing: link.externalListingId,
            });
            stats.linked += 1;
          }
        }
        for (const link of links) {
          if (link.status === 'live') {
            const mappingId = mappingIdOf(link.externalListingId);
            if (mappingId)
              await tx
                .update(channelListings)
                .set({ channexMappingId: mappingId })
                .where(eq(channelListings.id, link.id));
          }
        }
        if (!account.active && mappings.length) {
          await tx
            .update(channexChannels)
            .set({ active: true, lastCheckedAt: now.toISOString() })
            .where(eq(channexChannels.channexChannelId, account.channelId as string));
        }
      });
    } catch (error) {
      const message = messageOf(error);
      await deps.db.withOrg({ orgId }, async (tx) => {
        await tx
          .update(channelListings)
          .set({ lastError: message })
          .where(
            inArray(
              channelListings.id,
              waiting.map((l) => l.id),
            ),
          );
        await log(tx, orgId, null, 'link', 'error', { account: account.label, error: message });
      });
      stats.failed += waiting.length;
      if (!(error instanceof ChannelError && error.retryable)) {
        await deps.alerts.send({
          severity: 'warning',
          title: `Couldn't update the listing links on ${account.label}`,
          detail: message,
        });
      }
      if (!(error instanceof ChannelError)) throw error;
    }
  }
}

/** The loop: every operator, every few minutes. `refreshAll` is the hourly job. */
export async function syncChannelLinks(
  deps: WorkerDeps,
  options: { refreshAll?: boolean } = {},
): Promise<LinkStats> {
  const stats = zero();
  for (const org of await deps.db.listOrganisations()) {
    await connectPending(deps, org.id, stats);
    await checkConnections(deps, org.id, stats, options.refreshAll ?? false);
    await syncLinks(deps, org.id, stats);
    await syncAirbnb(deps, org.id, stats);
  }
  return stats;
}

/** Pence to pounds (or cents to dollars): Airbnb takes major units. */
const major = (minor: number | null) => (minor === null ? null : Math.round(minor) / 100);

/**
 * Airbnb specifics (step 8), through Channex: each live Airbnb link gets the property's fees,
 * prices and booking rules whenever they change (a database trigger marks the link due), and is
 * taken off Airbnb or put back when the team pauses or resumes it.
 */
async function syncAirbnb(deps: WorkerDeps, orgId: string, stats: LinkStats): Promise<void> {
  const now = (deps.now?.() ?? new Date()).toISOString();
  const due = await deps.db.withOrg({ orgId }, (tx) =>
    tx
      .select({
        id: channelListings.id,
        propertyId: channelListings.propertyId,
        externalListingId: channelListings.externalListingId,
        mappingId: channelListings.channexMappingId,
        settingsSyncedAt: channelListings.settingsSyncedAt,
        publishedWanted: channelListings.publishedWanted,
        published: channelListings.published,
        channelId: channexChannels.channexChannelId,
        currency: sql<string>`coalesce((select currency from app.organisation_settings limit 1), 'GBP')`,
        basePriceMinor: properties.basePriceMinor,
        weekendPriceMinor: properties.weekendPriceMinor,
        cleaningFeeMinor: properties.cleaningFeeMinor,
        extraGuestFeeMinor: properties.extraGuestFeeMinor,
        extraGuestFrom: properties.extraGuestFrom,
        securityDepositMinor: properties.securityDepositMinor,
        maxGuests: properties.maxGuests,
        instantBook: properties.instantBook,
        checkInTime: properties.checkInTime,
        checkOutTime: properties.checkOutTime,
        cancellationPolicy: properties.cancellationPolicy,
      })
      .from(channelListings)
      .innerJoin(properties, eq(properties.id, channelListings.propertyId))
      .innerJoin(channexChannels, eq(channexChannels.channelAccountId, channelListings.channelAccountId))
      .where(
        and(
          eq(channelListings.channel, 'airbnb'),
          eq(channelListings.status, 'live'),
          sql`(${channelListings.settingsSyncedAt} is null or ${channelListings.published} is distinct from ${channelListings.publishedWanted})`,
        ),
      ),
  );
  for (const link of due) {
    try {
      if (link.settingsSyncedAt === null && link.mappingId && link.basePriceMinor) {
        await deps.provider.setAirbnbListingSettings(link.channelId, link.mappingId, {
          currency: link.currency,
          defaultDailyPrice: major(link.basePriceMinor) as number,
          weekendPrice: major(link.weekendPriceMinor),
          guestsIncluded:
            link.extraGuestFeeMinor && link.extraGuestFrom
              ? Math.max(1, link.extraGuestFrom - 1)
              : link.maxGuests,
          pricePerExtraPerson: major(link.extraGuestFeeMinor) ?? 0,
          cleaningFee: major(link.cleaningFeeMinor),
          securityDeposit: major(link.securityDepositMinor),
          instantBook: link.instantBook,
          checkInTime: link.checkInTime.slice(0, 5),
          checkOutTime: link.checkOutTime.slice(0, 5),
          cancellationPolicy: (link.cancellationPolicy ?? 'moderate') as
            | 'flexible'
            | 'moderate'
            | 'firm'
            | 'strict'
            | 'non_refundable',
        });
        await deps.db.withOrg({ orgId }, async (tx) => {
          await tx
            .update(channelListings)
            .set({ settingsSyncedAt: now, settingsError: null })
            .where(eq(channelListings.id, link.id));
          await log(tx, orgId, link.propertyId, 'airbnb_settings', 'ok', { listing: link.externalListingId });
        });
      } else if (link.settingsSyncedAt === null) {
        // No price yet, or no mapping id: nothing to send until there is.
        await deps.db.withOrg({ orgId }, (tx) =>
          tx
            .update(channelListings)
            .set({
              settingsSyncedAt: now,
              settingsError: link.mappingId ? 'Set a nightly price before Airbnb can take the fees.' : null,
            })
            .where(eq(channelListings.id, link.id)),
        );
      }
      if (link.published !== link.publishedWanted) {
        await deps.provider.setListingPublished(link.channelId, link.externalListingId, link.publishedWanted);
        await deps.db.withOrg({ orgId }, async (tx) => {
          await tx
            .update(channelListings)
            .set({ published: link.publishedWanted, lastError: null })
            .where(eq(channelListings.id, link.id));
          await log(
            tx,
            orgId,
            link.propertyId,
            link.publishedWanted ? 'airbnb_resume' : 'airbnb_pause',
            'ok',
            {
              listing: link.externalListingId,
            },
          );
        });
      }
    } catch (error) {
      const message = messageOf(error);
      // A refusal stays on the link until the property changes again; a hiccup is tried next time.
      const permanent = !(error instanceof ChannelError && error.retryable);
      await deps.db.withOrg({ orgId }, async (tx) => {
        await tx
          .update(channelListings)
          .set(
            link.settingsSyncedAt === null
              ? { settingsError: message, ...(permanent ? { settingsSyncedAt: now } : {}) }
              : { lastError: message, ...(permanent ? { published: link.publishedWanted } : {}) },
          )
          .where(eq(channelListings.id, link.id));
        await log(tx, orgId, link.propertyId, 'airbnb_settings', 'error', {
          listing: link.externalListingId,
          error: message,
        });
      });
      stats.failed += 1;
      if (!(error instanceof ChannelError)) throw error;
    }
  }
}
