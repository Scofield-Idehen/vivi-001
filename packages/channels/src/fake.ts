import {
  type AirbnbListingSettings,
  type AvailabilityUpdate,
  type BookingRevision,
  ChannelError,
  type ChannelListingRef,
  type ChannelMapping,
  type ChannelMappingRef,
  type ChannelNight,
  type ChannelProvider,
  type ChannelRef,
  type ChannelSetup,
  type ChannelState,
  type ExternalPropertyRef,
  type ListingSetup,
  type PushResult,
  type RestrictionUpdate,
} from './provider.ts';

/**
 * An in-memory provider for tests and local development. Records every call and can be
 * told to fail, so retry and backoff paths can be tested without a network.
 */
export class FakeChannelProvider implements ChannelProvider {
  readonly name = 'fake';
  readonly availabilityCalls: AvailabilityUpdate[][] = [];
  readonly restrictionCalls: RestrictionUpdate[][] = [];
  readonly acknowledged: string[] = [];
  readonly listings: ListingSetup[] = [];
  readonly groups: string[] = [];
  /** Ids carry a token per instance, so two stand-ins in one test run never hand out the same id. */
  readonly token = Math.random().toString(36).slice(2, 8);
  feed: BookingRevision[] = [];
  private nextFailure: ChannelError | null = null;
  private taskCounter = 0;

  failNextCallWith(error: ChannelError): void {
    this.nextFailure = error;
  }

  private maybeFail(): void {
    if (this.nextFailure) {
      const error = this.nextFailure;
      this.nextFailure = null;
      throw error;
    }
  }

  async pushAvailability(updates: AvailabilityUpdate[]): Promise<PushResult> {
    this.maybeFail();
    this.availabilityCalls.push(updates);
    for (const u of updates) {
      for (let date = u.dateFrom; date <= u.dateTo; date = nextDay(date)) {
        this.setNight(u.ref.externalPropertyId, date, { available: u.available });
      }
    }
    return { taskId: `fake-task-${++this.taskCounter}`, warnings: [] };
  }

  async pushRestrictions(updates: RestrictionUpdate[]): Promise<PushResult> {
    this.maybeFail();
    this.restrictionCalls.push(updates);
    for (const u of updates) {
      const changes: Partial<ChannelNight> = {};
      // The stand-in keeps prices as Channex reads them back: two decimals, as "150.00".
      if (u.rateMinor !== undefined) changes.rate = (u.rateMinor / 100).toFixed(2);
      if (u.minStayArrival !== undefined) changes.minStayArrival = u.minStayArrival;
      if (u.maxStay !== undefined) changes.maxStay = u.maxStay;
      if (u.closedToArrival !== undefined) changes.closedToArrival = u.closedToArrival;
      if (u.closedToDeparture !== undefined) changes.closedToDeparture = u.closedToDeparture;
      if (u.stopSell !== undefined) changes.stopSell = u.stopSell;
      for (let date = u.dateFrom; date <= u.dateTo; date = nextDay(date)) {
        this.setNight(u.ref.externalPropertyId, date, changes);
      }
    }
    return { taskId: `fake-task-${++this.taskCounter}`, warnings: [] };
  }

  /** What the stand-in holds per property and night, as sent to it; tests change a night to stand in for drift. */
  readonly nights = new Map<string, Map<string, Partial<ChannelNight>>>();

  setNight(externalPropertyId: string, date: string, changes: Partial<ChannelNight>): void {
    const held = this.nights.get(externalPropertyId) ?? new Map<string, Partial<ChannelNight>>();
    held.set(date, { ...held.get(date), ...changes });
    this.nights.set(externalPropertyId, held);
  }

  async fetchInventory(ref: ExternalPropertyRef, dateFrom: string, dateTo: string): Promise<ChannelNight[]> {
    this.maybeFail();
    const held = this.nights.get(ref.externalPropertyId);
    const nights: ChannelNight[] = [];
    for (let date = dateFrom; date <= dateTo; date = nextDay(date)) {
      nights.push({
        date,
        available: null,
        rate: null,
        minStayArrival: null,
        maxStay: null,
        closedToArrival: null,
        closedToDeparture: null,
        stopSell: null,
        ...held?.get(date),
      });
    }
    return nights;
  }

  async fetchBookingRevisionFeed(options?: { externalPropertyId?: string }): Promise<BookingRevision[]> {
    this.maybeFail();
    return this.feed.filter(
      (r) =>
        !this.acknowledged.includes(r.id) &&
        (!options?.externalPropertyId || r.externalPropertyId === options.externalPropertyId),
    );
  }

  async acknowledgeBookingRevision(revisionId: string): Promise<void> {
    this.maybeFail();
    this.acknowledged.push(revisionId);
  }

  async createListing(setup: ListingSetup): Promise<ExternalPropertyRef> {
    this.maybeFail();
    this.listings.push(setup);
    const n = `${this.token}-${this.listings.length}`;
    return {
      externalPropertyId: `fake-property-${n}`,
      externalRoomTypeId: `fake-room-${n}`,
      externalRatePlanId: `fake-rate-${n}`,
    };
  }

  /** Which stand-in properties close booked nights themselves; tests switch one off to see it fixed. */
  readonly autoClose = new Map<string, boolean>();

  async ensureAutoClose(externalPropertyId: string): Promise<{ wasOn: boolean }> {
    this.maybeFail();
    const wasOn = this.autoClose.get(externalPropertyId) ?? true;
    this.autoClose.set(externalPropertyId, true);
    return { wasOn };
  }

  /** Connections the stand-in has made; tests authorise one by setting `active`. */
  readonly channels = new Map<
    string,
    { setup: ChannelSetup; active: boolean; mappings: ChannelMapping[]; listings: ChannelListingRef[] }
  >();

  async createChannel(setup: ChannelSetup): Promise<ChannelRef> {
    this.maybeFail();
    const channelId = `fake-channel-${this.token}-${this.channels.size + 1}`;
    this.channels.set(channelId, { setup, active: false, mappings: [], listings: [] });
    return {
      channelId,
      connectUrl: setup.channel === 'booking_com' ? null : `https://connect.example.test/${channelId}`,
    };
  }

  /** Stands in for the account's owner authorising, with the listings the channel then shows. */
  authorise(channelId: string, listings: ChannelListingRef[]): void {
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error(`No stand-in channel ${channelId}`);
    channel.active = true;
    channel.listings = listings;
  }

  async getChannelState(channelId: string): Promise<ChannelState> {
    this.maybeFail();
    const channel = this.channels.get(channelId);
    if (!channel) throw new ChannelError('No such channel', 'validation', 404);
    return { active: channel.active, externalAccountId: channel.active ? `host-${channelId}` : null };
  }

  async listChannelListings(channelId: string): Promise<ChannelListingRef[]> {
    this.maybeFail();
    return this.channels.get(channelId)?.listings ?? [];
  }

  async setChannelMappings(channelId: string, mappings: ChannelMapping[]): Promise<ChannelMappingRef[]> {
    this.maybeFail();
    const channel = this.channels.get(channelId);
    if (!channel) throw new ChannelError('No such channel', 'validation', 404);
    channel.mappings = [...mappings];
    return mappings.map((m) => ({ ...m, mappingId: `fake-mapping-${m.ratePlanId}-${m.externalListingId}` }));
  }

  /** Airbnb settings sent, by mapping id; and which listings are published (absent means never asked). */
  readonly airbnbSettings = new Map<string, AirbnbListingSettings>();
  readonly published = new Map<string, boolean>();

  async setAirbnbListingSettings(
    _channelId: string,
    mappingId: string,
    settings: AirbnbListingSettings,
  ): Promise<void> {
    this.maybeFail();
    this.airbnbSettings.set(mappingId, settings);
  }

  async setListingPublished(
    _channelId: string,
    externalListingId: string,
    published: boolean,
  ): Promise<void> {
    this.maybeFail();
    this.published.set(externalListingId, published);
  }

  async activateChannel(channelId: string): Promise<void> {
    this.maybeFail();
    const channel = this.channels.get(channelId);
    if (!channel) throw new ChannelError('No such channel', 'validation', 404);
    if (channel.mappings.length === 0)
      throw new ChannelError('A channel needs a mapping before activation', 'validation', 422);
    channel.active = true;
  }

  async createGroup(title: string): Promise<string> {
    this.maybeFail();
    this.groups.push(title);
    return `fake-group-${this.token}-${this.groups.length}`;
  }

  /** The stand-in stores a revision as itself, so reading it back is the revision less its payload. */
  parseRevision(raw: unknown): BookingRevision {
    const stored = raw as Partial<BookingRevision> | null;
    if (!stored || typeof stored.id !== 'string' || typeof stored.bookingId !== 'string') {
      throw new Error('Not a revision the stand-in recognises');
    }
    return { ...(stored as Omit<BookingRevision, 'raw'>), raw };
  }
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** A revision as the stand-in sends it: its payload is the revision itself, as a real one's would be. */
export function fakeRevision(revision: Omit<BookingRevision, 'raw'>): BookingRevision {
  return { ...revision, raw: { ...revision } };
}
