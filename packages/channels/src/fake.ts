import {
  type AvailabilityUpdate,
  type BookingRevision,
  ChannelError,
  type ChannelListingRef,
  type ChannelMapping,
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
    return { taskId: `fake-task-${++this.taskCounter}`, warnings: [] };
  }

  async pushRestrictions(updates: RestrictionUpdate[]): Promise<PushResult> {
    this.maybeFail();
    this.restrictionCalls.push(updates);
    return { taskId: `fake-task-${++this.taskCounter}`, warnings: [] };
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

  async setChannelMappings(channelId: string, mappings: ChannelMapping[]): Promise<void> {
    this.maybeFail();
    const channel = this.channels.get(channelId);
    if (!channel) throw new ChannelError('No such channel', 'validation', 404);
    channel.mappings = [...mappings];
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

/** A revision as the stand-in sends it: its payload is the revision itself, as a real one's would be. */
export function fakeRevision(revision: Omit<BookingRevision, 'raw'>): BookingRevision {
  return { ...revision, raw: { ...revision } };
}
