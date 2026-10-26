import type {
  GuestyCalendarDay,
  GuestyConversation,
  GuestyCustomField,
  GuestyListing,
  GuestyPost,
  GuestyReservation,
} from '@v01/integrations';
import { addDays } from '@v01/shared';

/**
 * What the import reads from Guesty. The live client reads it over the network; a snapshot holds
 * a copy read beforehand, so the database transaction never waits on Guesty. (An import of a few
 * thousand bookings spends most of its time waiting on Guesty; holding a transaction open through
 * that is what made long runs fail.)
 */
export interface GuestyReader {
  listings(): AsyncIterable<GuestyListing>;
  reservations(checkOutFrom: string): AsyncIterable<GuestyReservation>;
  calendar(listingId: string, from: string, to: string): Promise<GuestyCalendarDay[]>;
  customFields(listingId: string): Promise<GuestyCustomField[]>;
  conversations(reservationIds: string[]): AsyncIterable<GuestyConversation>;
  posts(conversationId: string): AsyncIterable<GuestyPost>;
  readonly tokensRemainingToday: number | null;
}

/** The calendar windows the import asks for: 180 days at a time, `ahead` days from `today`. */
export function calendarWindows(today: string, ahead: number): { from: string; to: string }[] {
  const last = addDays(today, ahead - 1);
  const windows = [];
  for (let from = today; from <= last; from = addDays(from, 180)) {
    const to = addDays(from, 179) < last ? addDays(from, 179) : last;
    windows.push({ from, to });
  }
  return windows;
}

type Kept<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function keep<T>(read: () => Promise<T>): Promise<Kept<T>> {
  try {
    return { ok: true, value: await read() };
  } catch (error) {
    return { ok: false, error };
  }
}

function give<T>(kept: Kept<T> | undefined, what: string): T {
  if (!kept) throw new Error(`${what} wasn't read from Guesty`);
  if (!kept.ok) throw kept.error;
  return kept.value;
}

export class GuestySnapshot implements GuestyReader {
  private listingList: GuestyListing[] = [];
  private reservationList: GuestyReservation[] = [];
  private reservationsFrom = '';
  private readonly calendars = new Map<string, Kept<GuestyCalendarDay[]>>();
  private readonly fields = new Map<string, Kept<GuestyCustomField[]>>();
  private conversationList: Kept<GuestyConversation[]> = { ok: true, value: [] };
  private readonly postsOf = new Map<string, Kept<GuestyPost[]>>();
  tokensRemainingToday: number | null = null;

  /**
   * Reads everything the import will ask for. A listing's calendar or fields Guesty won't give
   * are kept as the refusal, so the import reports them exactly as it would have live.
   */
  static async take(
    guesty: GuestyReader,
    plan: {
      today: string;
      calendarDaysAhead: number;
      bookingsFrom: string;
      /** Conversations for bookings leaving on or after this day; null leaves them out. */
      messagesFrom: string | null;
      onProgress?: (message: string) => void;
    },
  ): Promise<GuestySnapshot> {
    const s = new GuestySnapshot();
    const say = plan.onProgress ?? (() => {});
    for await (const listing of guesty.listings()) {
      s.listingList.push(listing);
      say(`Reading listing ${s.listingList.length}: ${listing.nickname ?? listing.title ?? listing._id}`);
      if (listing.type === 'MTL') continue;
      s.fields.set(listing._id, await keep(() => guesty.customFields(listing._id)));
      for (const w of calendarWindows(plan.today, plan.calendarDaysAhead)) {
        const days = await keep(() => guesty.calendar(listing._id, w.from, w.to));
        s.calendars.set(`${listing._id}|${w.from}|${w.to}`, days);
        if (!days.ok) break;
      }
    }
    say('Listings read. Reading bookings…');
    s.reservationsFrom = plan.bookingsFrom;
    for await (const r of guesty.reservations(plan.bookingsFrom)) {
      s.reservationList.push(r);
      if (s.reservationList.length % 250 === 0) say(`Bookings read: ${s.reservationList.length}`);
    }
    say(`Bookings read: ${s.reservationList.length}`);

    if (plan.messagesFrom) {
      const from = plan.messagesFrom;
      const ids = s.reservationList.filter((r) => (r.checkOutDateLocalized ?? '') >= from).map((r) => r._id);
      say(`Reading guest conversations for ${ids.length} bookings…`);
      const found: GuestyConversation[] = [];
      const seen = new Set<string>();
      const listed = await keep(async () => {
        for (let i = 0; i < ids.length; i += 25) {
          for await (const c of guesty.conversations(ids.slice(i, i + 25))) {
            if (!seen.has(c._id)) {
              seen.add(c._id);
              found.push(c);
            }
          }
        }
        return found;
      });
      s.conversationList = listed;
      for (const [n, c] of found.entries()) {
        s.postsOf.set(
          c._id,
          await keep(async () => {
            const posts: GuestyPost[] = [];
            for await (const p of guesty.posts(c._id)) posts.push(p);
            return posts;
          }),
        );
        if ((n + 1) % 50 === 0) say(`Conversations read: ${n + 1} of ${found.length}`);
      }
    }
    s.tokensRemainingToday = guesty.tokensRemainingToday;
    say('Everything read from Guesty. Saving…');
    return s;
  }

  async *listings(): AsyncIterable<GuestyListing> {
    yield* this.listingList;
  }

  async *reservations(checkOutFrom: string): AsyncIterable<GuestyReservation> {
    if (checkOutFrom < this.reservationsFrom) {
      throw new Error(`Bookings were read from ${this.reservationsFrom}, not ${checkOutFrom}`);
    }
    yield* this.reservationList.filter((r) => (r.checkOutDateLocalized ?? '') >= checkOutFrom);
  }

  async calendar(listingId: string, from: string, to: string): Promise<GuestyCalendarDay[]> {
    return give(
      this.calendars.get(`${listingId}|${from}|${to}`),
      `The calendar of ${listingId} from ${from}`,
    );
  }

  async customFields(listingId: string): Promise<GuestyCustomField[]> {
    return give(this.fields.get(listingId), `The custom fields of ${listingId}`);
  }

  async *conversations(reservationIds: string[]): AsyncIterable<GuestyConversation> {
    const wanted = new Set(reservationIds);
    for (const c of give(this.conversationList, 'The conversations')) {
      const ids = [c.reservation?._id, ...(c.meta?.reservations ?? []).map((r) => r._id)];
      if (ids.some((id) => id && wanted.has(id))) yield c;
    }
  }

  async *posts(conversationId: string): AsyncIterable<GuestyPost> {
    yield* give(this.postsOf.get(conversationId), `The messages of ${conversationId}`);
  }
}
