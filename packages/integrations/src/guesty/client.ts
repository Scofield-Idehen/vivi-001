/**
 * Guesty's Open API, read-only: what V-01 needs to bring an operator's listings, bookings and
 * calendars across (playbook, Section 13). Credentials come from Guesty → Settings → Integrations →
 * Open API, and live only in the worker's .env.
 *
 * Two limits shape this client (Guesty's quick-start article, 2026):
 * - a client id may ask for five tokens in 24 hours, so tokens are kept in a store and reused;
 * - 15 requests a second, 120 a minute, 5,000 an hour, with a Retry-After on a 429.
 */

export const GUESTY_API_URL = 'https://open-api.guesty.com';

export interface GuestyToken {
  accessToken: string;
  /** ISO time. */
  expiresAt: string;
}

/** Where a token is kept between runs, so a restart never spends one of the day's five. */
export interface GuestyTokenStore {
  load(clientId: string): Promise<GuestyToken | null>;
  save(clientId: string, token: GuestyToken, remainingToday: number | null): Promise<void>;
}

export class MemoryTokenStore implements GuestyTokenStore {
  private readonly tokens = new Map<string, GuestyToken>();
  async load(clientId: string): Promise<GuestyToken | null> {
    return this.tokens.get(clientId) ?? null;
  }
  async save(clientId: string, token: GuestyToken): Promise<void> {
    this.tokens.set(clientId, token);
  }
}

export interface GuestyConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  tokens?: GuestyTokenStore;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  now?: () => Date;
}

export class GuestyError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'rate_limited' | 'not_found' | 'server' | 'network' | 'response',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GuestyError';
  }
}

/** A page of results as Guesty sends it; some endpoints say `results`, some `items`. */
interface Page<T> {
  results?: T[];
  items?: T[];
  count?: number;
  limit?: number;
  skip?: number;
}

const DEFAULT_SLEEP = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

export class GuestyClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly tokens: GuestyTokenStore;
  private readonly baseUrl: string;
  private token: GuestyToken | null = null;
  /** How many tokens the service will still issue today, from its last answer. */
  tokensRemainingToday: number | null = null;

  constructor(private readonly config: GuestyConfig) {
    if (!config.clientId || !config.clientSecret) throw new Error('Guesty client id and secret are missing');
    this.fetchImpl = config.fetch ?? fetch;
    this.sleep = config.sleep ?? DEFAULT_SLEEP;
    this.tokens = config.tokens ?? new MemoryTokenStore();
    this.baseUrl = (config.baseUrl ?? GUESTY_API_URL).replace(/\/$/, '');
  }

  private now(): number {
    return (this.config.now?.() ?? new Date()).getTime();
  }

  /** A token with at least ten minutes left, from memory, the store, or Guesty. */
  async accessToken(): Promise<string> {
    const fresh = (t: GuestyToken | null): t is GuestyToken =>
      t !== null && Date.parse(t.expiresAt) - this.now() > 10 * 60_000;
    if (fresh(this.token)) return this.token.accessToken;
    const stored = await this.tokens.load(this.config.clientId);
    if (fresh(stored)) {
      this.token = stored;
      return stored.accessToken;
    }
    return this.requestToken();
  }

  private async requestToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'open-api',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body,
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000),
      });
    } catch (error) {
      throw new GuestyError(`Guesty token request failed: ${describe(error)}`, 'network');
    }
    const remaining = response.headers.get('x-ratelimit-remaining-day');
    this.tokensRemainingToday = remaining === null ? null : Number(remaining);
    const text = await response.text();
    if (!response.ok) {
      throw new GuestyError(
        `Guesty refused the credentials (${response.status}): ${text.slice(0, 200)}`,
        response.status === 429 ? 'rate_limited' : 'auth',
        response.status,
      );
    }
    let parsed: { access_token?: string; expires_in?: number };
    try {
      parsed = JSON.parse(text) as typeof parsed;
    } catch {
      throw new GuestyError('Guesty answered the token request with something that is not JSON', 'response');
    }
    if (!parsed.access_token) throw new GuestyError('Guesty answered without an access token', 'response');
    const token: GuestyToken = {
      accessToken: parsed.access_token,
      expiresAt: new Date(this.now() + (parsed.expires_in ?? 86_400) * 1000).toISOString(),
    };
    this.token = token;
    await this.tokens.save(this.config.clientId, token, this.tokensRemainingToday);
    return token.accessToken;
  }

  /** One GET, with the token; waits and tries again on a 429, a 5xx or no answer, a few times each. */
  async get<T = unknown>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const url = `${this.baseUrl}${path}${params.size ? `?${params}` : ''}`;
    for (let attempt = 1; ; attempt++) {
      const token = await this.accessToken();
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: 'GET',
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
          signal: AbortSignal.timeout(this.config.timeoutMs ?? 60_000),
        });
      } catch (error) {
        // A slow or dropped answer is usually Guesty catching its breath: wait, then ask again.
        if (attempt < 5) {
          await this.sleep(Math.min(30, 2 ** attempt * 2) * 1000);
          continue;
        }
        throw new GuestyError(`Guesty request failed: ${describe(error)}`, 'network');
      }
      if (response.status >= 500 && attempt < 5) {
        await this.sleep(Math.min(30, 2 ** attempt * 2) * 1000);
        continue;
      }
      if (response.status === 429 && attempt < 4) {
        const after = Number(response.headers.get('retry-after') ?? '2');
        await this.sleep(Math.max(1, Number.isFinite(after) ? after : 2) * 1000);
        continue;
      }
      if (response.status === 401 && attempt === 1) {
        // The stored token was revoked or expired early: one fresh one, then give up.
        this.token = null;
        await this.requestToken();
        continue;
      }
      const text = await response.text();
      if (!response.ok) {
        const kind =
          response.status === 404
            ? 'not_found'
            : response.status === 429
              ? 'rate_limited'
              : response.status === 401 || response.status === 403
                ? 'auth'
                : 'server';
        throw new GuestyError(
          `Guesty answered ${response.status} for ${path}: ${text.slice(0, 200)}`,
          kind,
          response.status,
        );
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new GuestyError(`Guesty answered ${path} with something that is not JSON`, 'response');
      }
    }
  }

  /** Every item of a paged list, page by page, in a stable order. */
  async *pages<T>(
    path: string,
    query: Record<string, string | number | undefined> = {},
    pageSize = 100,
  ): AsyncGenerator<T, void, void> {
    let skip = 0;
    for (;;) {
      const page = await this.get<Page<T>>(path, { ...query, limit: pageSize, skip });
      const items = page.results ?? page.items ?? [];
      for (const item of items) yield item;
      skip += items.length;
      if (items.length < pageSize || (page.count !== undefined && skip >= page.count)) return;
    }
  }

  // The reads the import makes. Field lists keep the answers small; Guesty ignores unknown names.

  listings(): AsyncGenerator<GuestyListing, void, void> {
    return this.pages<GuestyListing>('/v1/listings', { fields: LISTING_FIELDS, sort: '_id' });
  }

  /** Bookings leaving on or after `checkOutFrom` (YYYY-MM-DD), every status. */
  reservations(checkOutFrom: string): AsyncGenerator<GuestyReservation, void, void> {
    return this.pages<GuestyReservation>('/v1/reservations', {
      fields: RESERVATION_FIELDS,
      sort: '_id',
      filters: JSON.stringify([{ field: 'checkOutDateLocalized', operator: '$gte', value: checkOutFrom }]),
    });
  }

  /**
   * Guest conversations for these bookings (Guesty's Inbox), up to 25 bookings a request. Guesty
   * pages these with a cursor, not skip; the answer's shape varies, so it is read loosely.
   */
  async *conversations(reservationIds: string[]): AsyncGenerator<GuestyConversation, void, void> {
    const filters = JSON.stringify([{ field: 'reservation._id', operator: '$in', value: reservationIds }]);
    yield* this.cursorPages<GuestyConversation>('/v1/communication/conversations', ['conversations'], {
      filters,
      limit: 100,
    });
  }

  /** Every message in one conversation, oldest first. */
  async *posts(conversationId: string): AsyncGenerator<GuestyPost, void, void> {
    yield* this.cursorPages<GuestyPost>(
      `/v1/communication/conversations/${encodeURIComponent(conversationId)}/posts`,
      ['posts', 'thread'],
      { limit: 100, sort: 'createdAt' },
    );
  }

  private async *cursorPages<T>(
    path: string,
    keys: string[],
    query: Record<string, string | number | undefined>,
  ): AsyncGenerator<T, void, void> {
    let after: string | undefined;
    for (let page = 0; page < 200; page++) {
      const answer = await this.get<Record<string, unknown>>(path, { ...query, cursorAfter: after });
      const body = (answer.data && typeof answer.data === 'object' ? answer.data : answer) as Record<
        string,
        unknown
      >;
      let items: unknown = Array.isArray(body) ? body : undefined;
      for (const key of [...keys, 'results', 'items'])
        if (!items && Array.isArray(body[key])) items = body[key];
      const list = (Array.isArray(items) ? items : []) as T[];
      for (const item of list) yield item;
      const cursor = (body.cursor ?? answer.cursor) as { after?: string | null } | undefined;
      after = cursor?.after || undefined;
      if (!after || list.length === 0) return;
    }
  }

  /** A listing's calendar, night by night, across [from, to]. */
  async calendar(listingId: string, from: string, to: string): Promise<GuestyCalendarDay[]> {
    const answer = await this.get<{ data?: { days?: GuestyCalendarDay[] } } | { days?: GuestyCalendarDay[] }>(
      `/v1/availability-pricing/api/calendar/listings/${encodeURIComponent(listingId)}`,
      { startDate: from, endDate: to },
    );
    if ('data' in answer && answer.data?.days) return answer.data.days;
    if ('days' in answer && answer.days) return answer.days;
    return [];
  }

  /** The custom fields set on one property, with their names. */
  async customFields(listingId: string): Promise<GuestyCustomField[]> {
    const answer = await this.get<Page<GuestyCustomField> | GuestyCustomField[]>(
      `/v1/properties-api/custom-fields/${encodeURIComponent(listingId)}`,
    );
    if (Array.isArray(answer)) return answer;
    return answer.results ?? answer.items ?? [];
  }
}

function describe(error: unknown): string {
  const cause = error instanceof Error && error.cause instanceof Error ? ` (${error.cause.message})` : '';
  return `${String(error)}${cause}`;
}

const LISTING_FIELDS = [
  '_id',
  'title',
  'nickname',
  'active',
  'isListed',
  'type',
  'accommodates',
  'bedrooms',
  'bathrooms',
  'beds',
  'propertyType',
  'roomType',
  'address',
  'timezone',
  'amenities',
  'pictures',
  'terms',
  'prices',
  'publicDescription',
  'defaultCheckInTime',
  'defaultCheckOutTime',
  'integrations',
  'tags',
  'customFields',
  'houseRules',
  'createdAt',
].join(' ');

const RESERVATION_FIELDS = [
  '_id',
  'listingId',
  'status',
  'checkInDateLocalized',
  'checkOutDateLocalized',
  'checkIn',
  'checkOut',
  'guestId',
  'guest',
  'guestsCount',
  'numberOfGuests',
  'source',
  'platform',
  'integration',
  'confirmationCode',
  'money',
  'nightsCount',
  'plannedArrival',
  'plannedDeparture',
  'createdAt',
  'canceledAt',
].join(' ');

/** As much of a Guesty listing as the import reads. Anything else stays in `raw`. */
export interface GuestyListing {
  _id: string;
  title?: string | null;
  nickname?: string | null;
  active?: boolean;
  isListed?: boolean;
  /** SINGLE, MTL (multi-unit parent) or SUB (a unit of one). */
  type?: string;
  accommodates?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  beds?: number | null;
  propertyType?: string | null;
  roomType?: string | null;
  address?: {
    full?: string | null;
    street?: string | null;
    city?: string | null;
    state?: string | null;
    country?: string | null;
    zipcode?: string | null;
    apt?: string | null;
  } | null;
  timezone?: string | null;
  amenities?: string[] | null;
  pictures?:
    | { _id?: string; original?: string; regular?: string; thumbnail?: string; caption?: string | null }[]
    | null;
  terms?: { minNights?: number | null; maxNights?: number | null } | null;
  prices?: {
    currency?: string | null;
    basePrice?: number | null;
    weekendBasePrice?: number | null;
    cleaningFee?: number | null;
    extraPersonFee?: number | null;
    guestsIncludedInRegularFee?: number | null;
    securityDepositFee?: number | null;
  } | null;
  publicDescription?: {
    summary?: string | null;
    space?: string | null;
    access?: string | null;
    neighborhood?: string | null;
    transit?: string | null;
    notes?: string | null;
    houseRules?: string | null;
  } | null;
  defaultCheckInTime?: string | null;
  defaultCheckOutTime?: string | null;
  integrations?: GuestyIntegration[] | null;
  tags?: string[] | null;
  customFields?: { fieldId?: string; value?: unknown }[] | null;
  houseRules?: {
    petsAllowed?: boolean | null;
    smokingAllowed?: boolean | null;
    suitableForEvents?: boolean | null;
    suitableForChildren?: boolean | null;
  } | null;
  createdAt?: string | null;
}

/** One channel the listing sits on, as Guesty records it. */
export interface GuestyIntegration {
  _id?: string;
  platform?: string;
  externalId?: string | null;
  /** Account-level details differ by channel; the import looks for an account id in them. */
  [key: string]: unknown;
}

export interface GuestyReservation {
  _id: string;
  listingId?: string;
  status?: string;
  checkInDateLocalized?: string;
  checkOutDateLocalized?: string;
  checkIn?: string;
  checkOut?: string;
  guestId?: string | null;
  guest?: { _id?: string; fullName?: string | null; email?: string | null; phone?: string | null } | null;
  guestsCount?: number | null;
  numberOfGuests?: {
    numberOfAdults?: number | null;
    numberOfChildren?: number | null;
    numberOfInfants?: number | null;
  } | null;
  source?: string | null;
  platform?: string | null;
  integration?: { platform?: string | null } | null;
  confirmationCode?: string | null;
  money?: {
    currency?: string | null;
    totalPrice?: number | null;
    hostPayout?: number | null;
    netIncome?: number | null;
  } | null;
  nightsCount?: number | null;
  /** "15:00", when the guest said. */
  plannedArrival?: string | null;
  plannedDeparture?: string | null;
  createdAt?: string | null;
  canceledAt?: string | null;
}

export interface GuestyCalendarDay {
  date: string;
  status?: string;
  price?: number | null;
  currency?: string | null;
  isBasePrice?: boolean;
  minNights?: number | null;
  isBaseMinNights?: boolean;
  cta?: boolean;
  ctd?: boolean;
  note?: string | null;
  /** Which kind of hold: m manual, b booked, r reserved, and others Guesty adds. */
  blocks?: Record<string, boolean> | null;
}

export interface GuestyCustomField {
  _id?: string;
  fieldId?: string;
  displayName?: string | null;
  name?: string | null;
  title?: string | null;
  value?: unknown;
  [key: string]: unknown;
}

export interface GuestyConversation {
  _id: string;
  integration?: { platform?: string | null } | null;
  meta?: { reservations?: { _id?: string | null }[] | null } | null;
  reservation?: { _id?: string | null } | null;
}

/** One message. `type`: fromGuest, fromHost, fromGuesty, fromThirdParty or channel; `module`: email, sms, airbnb2, log… */
export interface GuestyPost {
  _id?: string;
  postId?: string;
  module?: string | null;
  type?: string | null;
  body?: string | null;
  subject?: string | null;
  createdAt?: string | null;
  sentAt?: string | null;
  isAutomatic?: boolean | null;
}
