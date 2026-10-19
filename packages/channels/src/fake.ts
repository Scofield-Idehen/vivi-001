import type {
  AvailabilityUpdate,
  BookingRevision,
  ChannelError,
  ChannelProvider,
  ExternalPropertyRef,
  ListingSetup,
  PushResult,
  RestrictionUpdate,
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
