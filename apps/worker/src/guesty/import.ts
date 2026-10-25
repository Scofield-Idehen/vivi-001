import {
  blocks,
  calendarDays,
  channelAccounts,
  customFields,
  guests,
  guestyAccounts,
  guestyChannelListings,
  guestyImports,
  guestyListings,
  guestyReservations,
  organisationSettings,
  properties,
  propertyAmenities,
  propertyFieldValues,
  propertyPhotos,
  reservations,
  type Tx,
} from '@v01/db';
import type { GuestyClient, GuestyListing, SecretBox } from '@v01/integrations';
import { addDays, CHANNEL_LABELS, type Channel, LINKABLE_CHANNELS, todayIn } from '@v01/shared';
import { and, eq, gte, like, sql } from 'drizzle-orm';
import type { WorkerDeps } from '../deps.ts';
import {
  accountKeyOf,
  calendarChanges,
  channelOf,
  externalListingIdOf,
  type OrgDefaults,
  propertyFromListing,
  reservationFrom,
} from './mapping.ts';

/**
 * The import from Guesty (playbook, Section 13; decisions, 19 Oct 2026): every listing becomes a
 * property that Guesty still runs (`managed_by = 'guesty'`, so V-01 sends nothing for it), with its
 * photos, amenities, custom fields, tags, nightly prices and blocks; every booking becomes a
 * reservation with its guest; and each listing's place on Airbnb, Booking.com and Vrbo is kept as
 * the account map the move-over step links from. Running it again updates what it made before.
 *
 * Everything happens in one transaction: either the whole import lands, or none of it does. A dry
 * run does the same work and rolls it back, so the report can be read before anything is kept.
 */

export interface ImportOptions {
  orgId: string;
  guesty: GuestyClient;
  /** Seals secret custom fields (lock codes, Wi-Fi passwords). Without it they are reported, not stored. */
  box?: SecretBox;
  dryRun?: boolean;
  /** How far back to bring bookings: stays that ended on or after this many days ago (365). */
  bookingsDaysBack?: number;
  /** How far ahead to read calendars (730). */
  calendarDaysAhead?: number;
  now?: Date;
  /** Told what the import is doing as it goes, so a long run shows it is moving. */
  onProgress?: (message: string) => void;
}

export interface ImportSummary {
  dryRun: boolean;
  listings: { seen: number; created: number; updated: number; archived: number; skipped: string[] };
  photos: number;
  amenities: { set: number; unknown: string[] };
  fields: { created: string[]; valuesSet: number; secretsSkipped: number };
  accounts: { channel: Channel; label: string; key: string }[];
  channelListings: number;
  calendar: { blocks: number; nights: number; blocksRefused: number };
  reservations: { seen: number; created: number; updated: number; conflicts: number; skipped: string[] };
  /** Per property, by name: what to look at. */
  warnings: Record<string, string[]>;
  /** The Guesty token budget, as the service last said. */
  tokensRemainingToday: number | null;
}

class RolledBack extends Error {}

const GUESTY_BLOCK = 'Blocked in Guesty';

const SECRET_NAME = /lock|code|pin\b|password|passcode|key ?safe|alarm/i;
const LINK_VALUE = /^https?:\/\/\S+$/i;

/** "Top Lock", "top-lock code" and "Top lock code" are the same field. */
function fieldKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/wi-?fi/g, 'wifi')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(code|the|a)\b/g, '')
    .trim();
}

function emptySummary(dryRun: boolean): ImportSummary {
  return {
    dryRun,
    listings: { seen: 0, created: 0, updated: 0, archived: 0, skipped: [] },
    photos: 0,
    amenities: { set: 0, unknown: [] },
    fields: { created: [], valuesSet: 0, secretsSkipped: 0 },
    accounts: [],
    channelListings: 0,
    calendar: { blocks: 0, nights: 0, blocksRefused: 0 },
    reservations: { seen: 0, created: 0, updated: 0, conflicts: 0, skipped: [] },
    warnings: {},
    tokensRemainingToday: null,
  };
}

export async function importFromGuesty(
  deps: Pick<WorkerDeps, 'db' | 'log'>,
  options: ImportOptions,
): Promise<ImportSummary> {
  const dryRun = options.dryRun ?? false;
  const summary = emptySummary(dryRun);
  const now = options.now ?? new Date();
  const log = deps.log;
  try {
    await deps.db.withOrg({ orgId: options.orgId }, async (tx) => {
      const [settings] = await tx
        .select({
          currency: organisationSettings.currency,
          countryCode: organisationSettings.countryCode,
          timeZone: organisationSettings.timeZone,
        })
        .from(organisationSettings);
      const org: OrgDefaults = {
        currency: settings?.currency ?? 'GBP',
        countryCode: settings?.countryCode ?? 'GB',
        timeZone: settings?.timeZone ?? 'Europe/London',
      };
      const today = todayIn(org.timeZone, now);
      const [run] = await tx
        .insert(guestyImports)
        .values({ organisationId: options.orgId, dryRun })
        .returning({ id: guestyImports.id });

      const importer = new Importer(tx, options, org, today, now, summary);
      await importer.listings();
      await importer.reservations(addDays(today, -(options.bookingsDaysBack ?? 365)));
      summary.tokensRemainingToday = options.guesty.tokensRemainingToday;

      if (run) {
        await tx
          .update(guestyImports)
          .set({ finishedAt: now.toISOString(), summary })
          .where(eq(guestyImports.id, run.id));
      }
      if (dryRun) throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
  log.info(
    {
      orgId: options.orgId,
      dryRun,
      listings: summary.listings.seen,
      reservations: summary.reservations.seen,
    },
    dryRun ? 'Guesty import rehearsed' : 'Guesty import done',
  );
  return summary;
}

/** The work of one import, inside its transaction. */
class Importer {
  /** Guesty listing id → V-01 property id, for the bookings. */
  private readonly propertyOf = new Map<string, string>();
  private readonly fieldIds = new Map<string, { id: string; kind: string }>();
  private readonly accountIds = new Map<string, string>();

  constructor(
    private readonly tx: Tx,
    private readonly options: ImportOptions,
    private readonly org: OrgDefaults,
    private readonly today: string,
    private readonly now: Date,
    private readonly summary: ImportSummary,
  ) {}

  private warn(propertyName: string, message: string): void {
    const list = this.summary.warnings[propertyName] ?? [];
    if (!list.includes(message)) list.push(message);
    this.summary.warnings[propertyName] = list;
  }

  async listings(): Promise<void> {
    await this.loadFields();
    await this.loadAccounts();
    for await (const listing of this.options.guesty.listings()) {
      this.summary.listings.seen += 1;
      this.options.onProgress?.(
        `Listing ${this.summary.listings.seen}: ${listing.nickname ?? listing.title ?? listing._id}`,
      );
      if (listing.type === 'MTL') {
        // A multi-unit parent: its units come as SUB listings of their own.
        this.summary.listings.skipped.push(
          `${listing.nickname ?? listing.title ?? listing._id}: multi-unit parent`,
        );
        continue;
      }
      await this.listing(listing);
    }
  }

  private async loadFields(): Promise<void> {
    const rows = await this.tx
      .select({ id: customFields.id, name: customFields.name, kind: customFields.kind })
      .from(customFields);
    for (const f of rows) this.fieldIds.set(fieldKey(f.name), { id: f.id, kind: f.kind });
  }

  private async loadAccounts(): Promise<void> {
    const rows = await this.tx
      .select({
        channel: guestyAccounts.channel,
        key: guestyAccounts.accountKey,
        id: guestyAccounts.id,
        label: channelAccounts.label,
      })
      .from(guestyAccounts)
      .innerJoin(channelAccounts, eq(channelAccounts.id, guestyAccounts.channelAccountId));
    for (const a of rows) {
      this.accountIds.set(`${a.channel}|${a.key}`, a.id);
      this.summary.accounts.push({ channel: a.channel, label: a.label, key: a.key });
    }
  }

  private async listing(listing: GuestyListing): Promise<void> {
    const mapped = propertyFromListing(listing, this.org);
    const name = mapped.values.name;
    for (const w of mapped.warnings) this.warn(name, w);
    const active = listing.active !== false;

    const [known] = await this.tx
      .select({ propertyId: guestyListings.propertyId, wasActive: guestyListings.active })
      .from(guestyListings)
      .where(eq(guestyListings.guestyListingId, listing._id));

    let propertyId: string;
    if (known) {
      propertyId = known.propertyId;
      await this.tx
        .update(properties)
        .set({
          ...mapped.values,
          ...(active ? { archivedAt: null } : known.wasActive ? { archivedAt: this.now.toISOString() } : {}),
        })
        .where(eq(properties.id, propertyId));
      await this.tx
        .update(guestyListings)
        .set({ nickname: listing.nickname ?? null, active, raw: listing, importedAt: this.now.toISOString() })
        .where(eq(guestyListings.guestyListingId, listing._id));
      this.summary.listings.updated += 1;
    } else {
      const [row] = await this.tx
        .insert(properties)
        .values({
          organisationId: this.options.orgId,
          ...mapped.values,
          // Guesty runs it until the move-over step; V-01 sends nothing for it meanwhile.
          managedBy: 'guesty',
          archivedAt: active ? null : this.now.toISOString(),
        })
        .returning({ id: properties.id });
      if (!row) throw new Error('Inserting the property returned nothing.');
      propertyId = row.id;
      await this.tx.insert(guestyListings).values({
        organisationId: this.options.orgId,
        propertyId,
        guestyListingId: listing._id,
        nickname: listing.nickname ?? null,
        active,
        raw: listing,
      });
      this.summary.listings.created += 1;
    }
    if (!active) this.summary.listings.archived += 1;
    this.propertyOf.set(listing._id, propertyId);

    await this.amenities(propertyId, mapped.amenities);
    await this.photos(propertyId, listing._id, mapped.photos);
    await this.fields(propertyId, listing, name);
    await this.channels(propertyId, listing, name);
    if (active) await this.calendar(propertyId, listing, mapped.values, name);
  }

  private async amenities(propertyId: string, codes: string[]): Promise<void> {
    await this.tx.delete(propertyAmenities).where(eq(propertyAmenities.propertyId, propertyId));
    if (codes.length) {
      await this.tx
        .insert(propertyAmenities)
        .values(codes.map((code) => ({ organisationId: this.options.orgId, propertyId, code })));
    }
    this.summary.amenities.set += codes.length;
  }

  /** Photos stay on Guesty's addresses for now; copying them into V-01's storage is a follow-up. */
  private async photos(
    propertyId: string,
    listingId: string,
    photos: { key: string; url: string; caption: string | null }[],
  ): Promise<void> {
    const prefix = `guesty/${listingId}/`;
    await this.tx
      .delete(propertyPhotos)
      .where(and(eq(propertyPhotos.propertyId, propertyId), like(propertyPhotos.storagePath, `${prefix}%`)));
    if (photos.length) {
      await this.tx.insert(propertyPhotos).values(
        photos.map((p, position) => ({
          organisationId: this.options.orgId,
          propertyId,
          storagePath: `${prefix}${p.key}`,
          url: p.url,
          position,
          caption: p.caption,
        })),
      );
    }
    this.summary.photos += photos.length;
  }

  private async fields(propertyId: string, listing: GuestyListing, name: string): Promise<void> {
    const values = listing.customFields ?? [];
    if (values.length === 0) return;
    let named: {
      fieldId?: string;
      _id?: string;
      displayName?: string | null;
      name?: string | null;
      title?: string | null;
      value?: unknown;
    }[] = [];
    try {
      named = await this.options.guesty.customFields(listing._id);
    } catch (error) {
      this.warn(
        name,
        `Guesty wouldn't list the custom fields' names: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const nameOf = new Map<string, string>();
    for (const f of named) {
      const id = f.fieldId ?? f._id;
      const title = f.displayName ?? f.name ?? f.title;
      if (id && title) nameOf.set(id, title);
    }
    for (const v of values) {
      if (!v.fieldId) continue;
      const raw = v.value;
      const text =
        raw === null || raw === undefined ? '' : typeof raw === 'string' ? raw.trim() : JSON.stringify(raw);
      if (!text) continue;
      const title = (nameOf.get(v.fieldId) ?? `Guesty field ${v.fieldId}`).slice(0, 60);
      const key = fieldKey(title);
      let field = this.fieldIds.get(key);
      if (!field) {
        const kind = SECRET_NAME.test(title)
          ? 'secret'
          : LINK_VALUE.test(text)
            ? 'link'
            : text.length > 200
              ? 'long_text'
              : 'text';
        const [row] = await this.tx
          .insert(customFields)
          .values({
            organisationId: this.options.orgId,
            name: title,
            kind,
            position: sql`(select coalesce(max(position), -1) + 1 from ${customFields})`,
          })
          .returning({ id: customFields.id, kind: customFields.kind });
        if (!row) continue;
        field = { id: row.id, kind: row.kind };
        this.fieldIds.set(key, field);
        this.summary.fields.created.push(title);
      }
      if (field.kind === 'secret') {
        if (!this.options.box) {
          this.summary.fields.secretsSkipped += 1;
          this.warn(name, `"${title}" is a secret and FIELD_SECRET_KEY is not set, so it was not stored.`);
          continue;
        }
        await this.setValue(propertyId, field.id, { value: null, secret: this.options.box.seal(text) });
      } else {
        await this.setValue(propertyId, field.id, { value: text.slice(0, 4000), secret: null });
      }
      this.summary.fields.valuesSet += 1;
    }
  }

  private async setValue(
    propertyId: string,
    fieldId: string,
    v: { value: string | null; secret: Buffer | null },
  ) {
    await this.tx
      .insert(propertyFieldValues)
      .values({ organisationId: this.options.orgId, propertyId, fieldId, ...v })
      .onConflictDoUpdate({
        target: [propertyFieldValues.propertyId, propertyFieldValues.fieldId],
        set: { ...v, updatedAt: this.now.toISOString() },
      });
  }

  /** The account map: which account each listing sits on, per channel. */
  private async channels(propertyId: string, listing: GuestyListing, name: string): Promise<void> {
    for (const integration of listing.integrations ?? []) {
      const channel = channelOf(integration.platform);
      if (!channel || !(LINKABLE_CHANNELS as readonly string[]).includes(channel)) continue;
      const externalListingId = externalListingIdOf(integration);
      if (!externalListingId) {
        this.warn(name, `The ${CHANNEL_LABELS[channel]} connection has no listing id in Guesty's record.`);
        continue;
      }
      const key = accountKeyOf(integration);
      if (key === 'unknown') {
        this.warn(
          name,
          `Couldn't tell which ${CHANNEL_LABELS[channel]} account the listing is on; it went under "unknown".`,
        );
      }
      const accountId = await this.account(channel, key);
      await this.tx
        .insert(guestyChannelListings)
        .values({
          organisationId: this.options.orgId,
          propertyId,
          channel,
          guestyAccountId: accountId,
          externalListingId,
          raw: integration,
        })
        .onConflictDoUpdate({
          target: [
            guestyChannelListings.propertyId,
            guestyChannelListings.channel,
            guestyChannelListings.externalListingId,
          ],
          set: { guestyAccountId: accountId, raw: integration, importedAt: this.now.toISOString() },
        });
      this.summary.channelListings += 1;
    }
  }

  /** A V-01 channel account for each account Guesty's listings sit on: "Airbnb A", "Airbnb B"… */
  private async account(channel: Channel, key: string): Promise<string> {
    const mapKey = `${channel}|${key}`;
    const known = this.accountIds.get(mapKey);
    if (known) return known;
    const onChannel = this.summary.accounts.filter((a) => a.channel === channel).length;
    const label = `${CHANNEL_LABELS[channel]} ${String.fromCharCode(65 + (onChannel % 26))}${onChannel >= 26 ? onChannel : ''}`;
    const [account] = await this.tx
      .insert(channelAccounts)
      .values({ organisationId: this.options.orgId, channel, label, status: 'disconnected' })
      .returning({ id: channelAccounts.id });
    if (!account) throw new Error('Inserting the channel account returned nothing.');
    const [row] = await this.tx
      .insert(guestyAccounts)
      .values({ organisationId: this.options.orgId, channel, accountKey: key, channelAccountId: account.id })
      .returning({ id: guestyAccounts.id });
    if (!row) throw new Error('Inserting the account map returned nothing.');
    this.accountIds.set(mapKey, row.id);
    this.summary.accounts.push({ channel, label, key });
    return row.id;
  }

  private async calendar(
    propertyId: string,
    listing: GuestyListing,
    usual: { basePriceMinor: number | null; weekendPriceMinor: number | null; minNights: number },
    name: string,
  ): Promise<void> {
    const ahead = this.options.calendarDaysAhead ?? 730;
    const currency = listing.prices?.currency?.toUpperCase() || this.org.currency;
    const days = [];
    for (let from = this.today; from <= addDays(this.today, ahead - 1); from = addDays(from, 180)) {
      const to =
        addDays(from, 179) < addDays(this.today, ahead - 1)
          ? addDays(from, 179)
          : addDays(this.today, ahead - 1);
      try {
        days.push(...(await this.options.guesty.calendar(listing._id, from, to)));
      } catch (error) {
        this.warn(
          name,
          `Guesty wouldn't give the calendar from ${from}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return;
      }
    }
    const changes = calendarChanges(days, usual, currency);

    // Blocks the last import made, from today on, go and come back as Guesty has them now.
    await this.tx
      .delete(blocks)
      .where(
        and(
          eq(blocks.propertyId, propertyId),
          like(blocks.reason, `${GUESTY_BLOCK}%`),
          gte(blocks.startsOn, this.today),
        ),
      );
    for (const b of changes.blocks) {
      try {
        await this.tx.transaction((sp) =>
          sp.insert(blocks).values({
            organisationId: this.options.orgId,
            propertyId,
            startsOn: b.startsOn,
            endsOn: b.endsOn,
            reason: b.reason ? `${GUESTY_BLOCK}: ${b.reason}`.slice(0, 200) : GUESTY_BLOCK,
          }),
        );
        this.summary.calendar.blocks += 1;
      } catch {
        this.summary.calendar.blocksRefused += 1;
        this.warn(name, `A block from ${b.startsOn} overlaps a booking and was left out.`);
      }
    }

    await this.tx
      .delete(calendarDays)
      .where(and(eq(calendarDays.propertyId, propertyId), gte(calendarDays.night, this.today)));
    if (changes.nights.length) {
      await this.tx
        .insert(calendarDays)
        .values(changes.nights.map((n) => ({ organisationId: this.options.orgId, propertyId, ...n })));
    }
    this.summary.calendar.nights += changes.nights.length;
  }

  async reservations(from: string): Promise<void> {
    const guestByEmail = new Map<string, string>();
    this.options.onProgress?.('Listings done. Reading bookings…');
    for await (const r of this.options.guesty.reservations(from)) {
      this.summary.reservations.seen += 1;
      if (this.summary.reservations.seen % 50 === 0)
        this.options.onProgress?.(`Bookings read: ${this.summary.reservations.seen}`);
      const propertyId = r.listingId ? this.propertyOf.get(r.listingId) : undefined;
      if (!propertyId) {
        this.summary.reservations.skipped.push(`${r.confirmationCode ?? r._id}: its listing wasn't imported`);
        continue;
      }
      const mapped = reservationFrom(r, this.org);
      if (!mapped.ok) {
        this.summary.reservations.skipped.push(`${r.confirmationCode ?? r._id}: ${mapped.reason}`);
        continue;
      }
      const v = mapped.value;

      let guestId: string | null = null;
      if (v.guest) {
        const email = v.guest.email;
        guestId = email ? (guestByEmail.get(email) ?? null) : null;
        if (!guestId && email) {
          const [found] = await this.tx.select({ id: guests.id }).from(guests).where(eq(guests.email, email));
          guestId = found?.id ?? null;
        }
        if (!guestId) {
          const [row] = await this.tx
            .insert(guests)
            .values({ organisationId: this.options.orgId, ...v.guest })
            .returning({ id: guests.id });
          guestId = row?.id ?? null;
        }
        if (email && guestId) guestByEmail.set(email, guestId);
      }

      const [known] = await this.tx
        .select({ reservationId: guestyReservations.reservationId })
        .from(guestyReservations)
        .where(eq(guestyReservations.guestyReservationId, r._id));
      const stay = {
        propertyId,
        channel: v.channel,
        channelReference: v.channelReference,
        checkIn: v.checkIn,
        checkOut: v.checkOut,
        adults: v.adults,
        children: v.children,
        infants: v.infants,
        currency: v.currency,
        totalMinor: v.totalMinor,
        payoutMinor: v.payoutMinor,
        checkInTime: v.checkInTime,
        checkOutTime: v.checkOutTime,
        cancelledAt: v.cancelledAt,
        ...(guestId ? { guestId } : {}),
      };
      const save = async (t: Tx, status: typeof v.status): Promise<string> => {
        if (known) {
          await t
            .update(reservations)
            .set({ ...stay, status })
            .where(eq(reservations.id, known.reservationId));
          return known.reservationId;
        }
        const [row] = await t
          .insert(reservations)
          .values({ organisationId: this.options.orgId, ...stay, status })
          .returning({ id: reservations.id });
        if (!row) throw new Error('Inserting the reservation returned nothing.');
        return row.id;
      };
      let reservationId: string;
      try {
        if (v.status === 'confirmed') {
          try {
            reservationId = await this.tx.transaction((sp) => save(sp, 'confirmed'));
          } catch (error) {
            if (pgCode(error) !== '23P01') throw error;
            reservationId = await save(this.tx, 'conflict');
            this.summary.reservations.conflicts += 1;
          }
        } else {
          reservationId = await save(this.tx, v.status);
        }
      } catch (error) {
        if (pgCode(error) === '23505') {
          // The same channel code is already on a booking V-01 has (say, one Channex sent): leave it.
          this.summary.reservations.skipped.push(`${v.channelReference}: already in V-01 under that code`);
          continue;
        }
        throw error;
      }
      if (known) this.summary.reservations.updated += 1;
      else {
        await this.tx.insert(guestyReservations).values({
          organisationId: this.options.orgId,
          reservationId,
          guestyReservationId: r._id,
        });
        this.summary.reservations.created += 1;
      }
    }
  }
}

function pgCode(error: unknown): string | undefined {
  const e = error as { code?: string; cause?: { code?: string } } | undefined;
  return e?.code ?? e?.cause?.code;
}
