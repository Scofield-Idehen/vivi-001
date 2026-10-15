import {
  CHANNEX_PRODUCTION_URL,
  CHANNEX_STAGING_URL,
  ChannelError,
  ChannexClient,
  ChannexProvider,
  type ExternalPropertyRef,
  type PushResult,
} from '@v01/channels';
import { addDays, formatMoney, minorDigits } from '@v01/shared';

/**
 * `pnpm channex:check`: proves V-01 can talk to Channex with the key in apps/worker/.env.
 *
 *   pnpm channex:check
 *     Which Channex server knows the key; the properties in the account with their room types,
 *     rate plans and channels; and how many booking changes wait in the feed. Reads only.
 *
 *   pnpm channex:check --round-trip <Channex property id>
 *     Staging only. Sends a test price, minimum stay and closed night for one date about 300 days
 *     ahead through V-01's own adapter, reads them back from Channex, then puts the night back.
 *
 * It never prints the key, and never acknowledges a booking, so nothing leaves the feed.
 */

export interface CheckOptions {
  apiKey: string | undefined;
  /** CHANNEX_BASE_URL, when set. Otherwise staging is tried first, then live. */
  baseUrl?: string | undefined;
  /** A Channex property id to run the round trip on. */
  roundTrip?: string | undefined;
  /** The text of apps/worker/.env.example, to catch a key pasted there by mistake. */
  exampleEnv?: string | null;
  print: (line: string) => void;
  fetch?: typeof fetch;
  now?: Date;
  /** Waits between read-backs while Channex applies a change. */
  sleep?: (ms: number) => Promise<void>;
}

type Server = 'staging' | 'live' | 'other';

const SERVER_NAMES: Record<Server, string> = {
  staging: 'Channex staging',
  live: 'Channex live',
  other: 'The Channex server in CHANNEX_BASE_URL',
};

/** How many properties get their room types, rate plans and channels listed. */
const DETAILED = 10;
const ROUND_TRIP_DAYS_AHEAD = 300;
const READ_BACK_TRIES = 5;

interface Resource {
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: unknown } | undefined>;
}

interface Night {
  rateMinor: number | null;
  minStay: number | null;
  available: number | null;
}

/** True when the example file holds what looks like a real key, commented out or not. */
export function keyInExampleEnv(text: string | null | undefined): boolean {
  return Boolean(text && /^[ \t]*#?[ \t]*CHANNEX_API_KEY[ \t]*=[ \t]*\S{8,}/m.test(text));
}

class Report {
  failures = 0;
  constructor(private readonly print: (line: string) => void) {}
  line(text = ''): void {
    this.print(text);
  }
  ok(text: string): void {
    this.print(`  ✓ ${text}`);
  }
  fail(text: string): void {
    this.failures += 1;
    this.print(`  ✗ ${text}`);
  }
  note(text: string): void {
    this.print(`    ${text}`);
  }
}

export async function runChannexCheck(options: CheckOptions): Promise<boolean> {
  const out = new Report(options.print);
  out.line('V-01 Channex check');
  out.line();

  if (keyInExampleEnv(options.exampleEnv)) {
    out.fail('There is a Channex key in apps/worker/.env.example, which git tracks.');
    out.note(
      'Run "git checkout -- apps/worker/.env.example" to take it out. Keep the key in apps/worker/.env.',
    );
  }

  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    out.fail('No CHANNEX_API_KEY in apps/worker/.env.');
    out.note('Add a line to that file: CHANNEX_API_KEY= followed by the key. Then run this again.');
    return false;
  }

  const connection = await connect(apiKey, options, out);
  if (!connection) return false;
  const { client, server } = connection;

  try {
    await describeAccount(client, out);
  } catch (error) {
    out.fail(`Couldn't read the account: ${messageOf(error)}`);
  }

  if (options.roundTrip) {
    try {
      await roundTrip(client, server, options.roundTrip, options, out);
    } catch (error) {
      out.fail(`The round trip stopped: ${messageOf(error)}`);
    }
  } else if (server === 'staging') {
    out.line();
    out.line('To send a test price to one of these properties and read it back (staging only):');
    out.line('  pnpm channex:check --round-trip <Channex property id>');
  }

  out.line();
  out.line(out.failures === 0 ? 'All good.' : `${plural(out.failures, 'problem')} found.`);
  return out.failures === 0;
}

function serverOf(baseUrl: string): Server {
  const host = hostOf(baseUrl);
  if (host === hostOf(CHANNEX_STAGING_URL)) return 'staging';
  if (host === hostOf(CHANNEX_PRODUCTION_URL)) return 'live';
  return 'other';
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Tries staging, then live, unless CHANNEX_BASE_URL names a server. A refused key is not an error here. */
async function connect(
  apiKey: string,
  options: CheckOptions,
  out: Report,
): Promise<{ client: ChannexClient; server: Server } | null> {
  const candidates = options.baseUrl ? [options.baseUrl] : [CHANNEX_STAGING_URL, CHANNEX_PRODUCTION_URL];
  const refused: Server[] = [];
  for (const baseUrl of candidates) {
    const server = serverOf(baseUrl);
    const client = new ChannexClient({
      baseUrl,
      apiKey,
      timeoutMs: 20_000,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    try {
      await client.request('GET', `/properties?${page(1, 1)}`);
      const also = refused.length
        ? ` (${refused.map((s) => SERVER_NAMES[s]).join(' and ')} didn't know it)`
        : '';
      out.ok(`${SERVER_NAMES[server]} accepted the key${also}.`);
      return { client, server };
    } catch (error) {
      if (error instanceof ChannelError && error.kind === 'auth') {
        refused.push(server);
        continue;
      }
      out.fail(`Couldn't reach ${SERVER_NAMES[server]}: ${messageOf(error)}`);
      out.note('Check this computer is online. Nothing else was tried.');
      return null;
    }
  }
  out.fail(`${refused.map((s) => SERVER_NAMES[s]).join(' and ')} refused the key.`);
  out.note('Check it was copied whole, with no spaces or quotes around it, or make a new key in Channex.');
  return null;
}

async function describeAccount(client: ChannexClient, out: Report): Promise<void> {
  const properties = await list(client, '/properties');
  if (properties.length === 0) {
    out.ok('The account has no properties yet.');
    out.note(
      'Expected on a new account: V-01 will create its properties in Channex when they are connected.',
    );
  } else {
    out.ok(`${plural(properties.length, 'property', 'properties')} in the account:`);
  }

  let channels: Resource[] = [];
  let channelsRead = true;
  try {
    channels = await list(client, '/channels');
  } catch (error) {
    channelsRead = false;
    out.fail(`Couldn't list the channels: ${messageOf(error)}`);
  }

  for (const property of properties.slice(0, DETAILED)) {
    const currency = text(property, 'currency');
    out.line();
    out.note(`${text(property, 'title') ?? 'Untitled'}${currency ? ` (${currency})` : ''}`);
    out.note(`  Channex id: ${property.id}`);
    const filter = new URLSearchParams({ 'filter[property_id]': property.id });
    const [roomTypes, ratePlans] = await Promise.all([
      list(client, `/room_types?${filter}`),
      list(client, `/rate_plans?${filter}`),
    ]);
    out.note(`  Room types: ${names(roomTypes, roomTypeLabel) ?? 'none yet'}`);
    out.note(`  Rate plans: ${names(ratePlans, (r) => text(r, 'title') ?? r.id) ?? 'none yet'}`);
    if (channelsRead) {
      const linked = channels.filter((c) => channelPropertyIds(c).includes(property.id));
      out.note(`  Channels: ${names(linked, channelLabel) ?? 'none linked yet'}`);
    }
  }
  if (properties.length > DETAILED) {
    out.line();
    out.note(`and ${plural(properties.length - DETAILED, 'more property', 'more properties')}.`);
  }

  out.line();
  const feed = await client.request<Resource[]>('GET', `/booking_revisions/feed?${page(1, 100)}`);
  const shown = Array.isArray(feed.data) ? feed.data.length : 0;
  const waiting = typeof feed.meta?.total === 'number' ? feed.meta.total : shown;
  if (waiting === 0) {
    out.ok('No booking changes are waiting in the feed.');
  } else {
    const count = shown === 100 && typeof feed.meta?.total !== 'number' ? '100 or more' : String(waiting);
    out.ok(`${count} booking change${waiting === 1 ? ' is' : 's are'} waiting in the feed.`);
    out.note('Left where they are: V-01 acknowledges each one only after saving it.');
  }
}

async function roundTrip(
  client: ChannexClient,
  server: Server,
  propertyId: string,
  options: CheckOptions,
  out: Report,
): Promise<void> {
  out.line();
  out.line('Round trip');
  if (server !== 'staging') {
    out.fail(
      `The round trip changes a price, so it only runs on Channex staging. This key is for ${server === 'live' ? 'Channex live' : 'another server'}.`,
    );
    return;
  }

  const property = await one(client, `/properties/${encodeURIComponent(propertyId)}`);
  if (!property) {
    out.fail(`Channex has no property with the id ${propertyId}.`);
    return;
  }
  const currency = text(property, 'currency') ?? 'GBP';
  const filter = new URLSearchParams({ 'filter[property_id]': propertyId });
  const [roomTypes, ratePlans] = await Promise.all([
    list(client, `/room_types?${filter}`),
    list(client, `/rate_plans?${filter}`),
  ]);
  const roomType = roomTypes[0];
  const ratePlan =
    ratePlans.find((r) => relatedIds(r, 'room_type').includes(roomType?.id ?? '')) ?? ratePlans[0];
  if (!roomType || !ratePlan) {
    out.fail('This property needs a room type and a rate plan in Channex before the round trip can run.');
    return;
  }

  const ref: ExternalPropertyRef = {
    externalPropertyId: propertyId,
    externalRoomTypeId: roomType.id,
    externalRatePlanId: ratePlan.id,
  };
  const date = addDays(isoDay(options.now ?? new Date()), ROUND_TRIP_DAYS_AHEAD);
  out.note(`${text(property, 'title') ?? 'Untitled'}, ${longDate(date)}`);

  const before = await readNight(client, ref, date, currency);
  out.ok(`Read the night as it is: ${describeNight(before, currency)}.`);

  const unit = 10 ** minorDigits(currency);
  const test: Night = {
    rateMinor: before.rateMinor && before.rateMinor > 0 ? before.rateMinor + unit : 150 * unit,
    minStay: before.minStay === 2 ? 3 : 2,
    available: before.available === 0 ? 1 : 0,
  };
  // V-01's own adapter does the sending: this is what the worker will send.
  const provider = new ChannexProvider(client);
  const sent = await send(provider, ref, date, test);
  if (!reportSend(sent, `Sent ${describeNight(test, currency)}`, out)) return;

  const after = await readUntil(client, ref, date, currency, test, options);
  if (sameNight(after, test)) {
    out.ok(`Channex shows ${describeNight(after, currency)}.`);
  } else {
    out.fail(`Channex shows ${describeNight(after, currency)}, not ${describeNight(test, currency)}.`);
    if (test.rateMinor !== null && after.rateMinor === test.rateMinor * unit) {
      out.note('Channex read the price as whole units. The adapter needs to send prices as decimals.');
    }
  }

  // Put the night back. A night with no price before keeps the test price: Channex has no "no price".
  const restore: Night = {
    rateMinor: before.rateMinor && before.rateMinor > 0 ? before.rateMinor : null,
    minStay: before.minStay && before.minStay > 0 ? before.minStay : 1,
    available: before.available,
  };
  const restored = await send(provider, ref, date, restore);
  if (!reportSend(restored, 'Put the night back', out)) return;
  const final = await readUntil(client, ref, date, currency, restore, options);
  if (sameNight(final, restore)) {
    out.ok(`Channex shows the night as it was: ${describeNight(final, currency)}.`);
  } else {
    out.fail(`After putting it back, Channex shows ${describeNight(final, currency)}.`);
  }
  if (restore.rateMinor === null) {
    out.note(
      'There was no price on that night before, so the test price stays. It is staging, 300 days ahead.',
    );
  }
}

interface Sent {
  restrictions: PushResult;
  availability: PushResult | null;
}

async function send(
  provider: ChannexProvider,
  ref: ExternalPropertyRef,
  date: string,
  night: Night,
): Promise<Sent> {
  const restrictions = await provider.pushRestrictions([
    {
      ref,
      dateFrom: date,
      dateTo: date,
      ...(night.rateMinor !== null ? { rateMinor: night.rateMinor } : {}),
      ...(night.minStay !== null ? { minStayArrival: night.minStay } : {}),
    },
  ]);
  const availability =
    night.available === null
      ? null
      : await provider.pushAvailability([{ ref, dateFrom: date, dateTo: date, available: night.available }]);
  return { restrictions, availability };
}

function reportSend(sent: Sent, what: string, out: Report): boolean {
  const warnings = [...sent.restrictions.warnings, ...(sent.availability?.warnings ?? [])];
  const tasks = [sent.restrictions.taskId, sent.availability?.taskId].filter(Boolean);
  if (warnings.length) {
    out.fail(`${what}, but Channex turned part of it down:`);
    for (const warning of warnings) out.note(`  ${warning}`);
    return false;
  }
  out.ok(`${what}${tasks.length ? ` (Channex task ${tasks.join(', ')})` : ''}.`);
  return true;
}

async function readNight(
  client: ChannexClient,
  ref: ExternalPropertyRef,
  date: string,
  currency: string,
): Promise<Night> {
  const range = {
    'filter[property_id]': ref.externalPropertyId,
    'filter[date][gte]': date,
    'filter[date][lte]': date,
  };
  const restrictions = await client.request<Record<string, Record<string, Record<string, unknown>>>>(
    'GET',
    `/restrictions?${new URLSearchParams({ ...range, 'filter[restrictions]': 'rate,min_stay_arrival' })}`,
  );
  const availability = await client.request<Record<string, Record<string, unknown>>>(
    'GET',
    `/availability?${new URLSearchParams(range)}`,
  );
  const values = restrictions.data?.[ref.externalRatePlanId]?.[date] ?? {};
  return {
    rateMinor: toMinor(values.rate, currency),
    minStay: toNumber(values.min_stay_arrival),
    available: toNumber(availability.data?.[ref.externalRoomTypeId]?.[date]),
  };
}

/** Channex applies changes quickly but not always instantly, so read a few times before calling it wrong. */
async function readUntil(
  client: ChannexClient,
  ref: ExternalPropertyRef,
  date: string,
  currency: string,
  expected: Night,
  options: CheckOptions,
): Promise<Night> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  let night = await readNight(client, ref, date, currency);
  for (let tries = 1; tries < READ_BACK_TRIES && !sameNight(night, expected); tries++) {
    await sleep(1500);
    night = await readNight(client, ref, date, currency);
  }
  return night;
}

/** Compares what was sent: a part that wasn't sent (null) is not compared. */
function sameNight(actual: Night, expected: Night): boolean {
  return (
    (expected.rateMinor === null || actual.rateMinor === expected.rateMinor) &&
    (expected.minStay === null || actual.minStay === expected.minStay) &&
    (expected.available === null || actual.available === expected.available)
  );
}

function describeNight(night: Night, currency: string): string {
  const price =
    night.rateMinor === null
      ? 'no price'
      : `${formatMoney({ amountMinor: night.rateMinor, currency })} a night`;
  const stay = night.minStay === null ? 'no minimum stay' : `minimum stay ${night.minStay}`;
  const open =
    night.available === null
      ? 'availability not set'
      : night.available === 0
        ? 'closed'
        : night.available === 1
          ? 'open'
          : `${night.available} available`;
  return `${price}, ${stay}, ${open}`;
}

async function list(client: ChannexClient, path: string, maxPages = 5): Promise<Resource[]> {
  const items: Resource[] = [];
  for (let n = 1; n <= maxPages; n++) {
    const joiner = path.includes('?') ? '&' : '?';
    const envelope = await client.request<Resource[]>('GET', `${path}${joiner}${page(n, 100)}`);
    const data = Array.isArray(envelope.data) ? envelope.data : [];
    items.push(...data);
    const total = envelope.meta?.total;
    if (data.length < 100 || (typeof total === 'number' && items.length >= total)) break;
  }
  return items;
}

async function one(client: ChannexClient, path: string): Promise<Resource | null> {
  try {
    const envelope = await client.request<Resource>('GET', path);
    return envelope.data && typeof envelope.data === 'object' ? envelope.data : null;
  } catch (error) {
    if (error instanceof ChannelError && error.status === 404) return null;
    throw error;
  }
}

function page(n: number, limit: number): URLSearchParams {
  return new URLSearchParams({ 'pagination[page]': String(n), 'pagination[limit]': String(limit) });
}

function text(resource: Resource, key: string): string | null {
  const value = resource.attributes?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function relatedIds(resource: Resource, key: string): string[] {
  const data = resource.relationships?.[key]?.data;
  const items = Array.isArray(data) ? data : data ? [data] : [];
  return items
    .map((item) => (item && typeof item === 'object' && 'id' in item ? String(item.id) : null))
    .filter((id): id is string => Boolean(id));
}

function channelPropertyIds(channel: Resource): string[] {
  const listed = channel.attributes?.properties;
  const fromAttributes = Array.isArray(listed)
    ? listed.map((p) =>
        typeof p === 'string' ? p : p && typeof p === 'object' && 'id' in p ? String(p.id) : '',
      )
    : [];
  return [...fromAttributes, ...relatedIds(channel, 'properties'), ...relatedIds(channel, 'property')];
}

const CHANNEL_NAMES: Record<string, string> = {
  airbnb: 'Airbnb',
  bookingcom: 'Booking.com',
  vrbo: 'Vrbo',
  homeaway: 'Vrbo',
  expedia: 'Expedia',
};

function channelLabel(channel: Resource): string {
  const code = text(channel, 'channel') ?? '';
  const name = CHANNEL_NAMES[code.toLowerCase().replace(/[^a-z]/g, '')] ?? (code || 'Channel');
  const title = text(channel, 'title');
  const active = channel.attributes?.is_active;
  const state = active === true ? 'on' : active === false ? 'off' : null;
  return [title && title !== name ? `${name} "${title}"` : name, state].filter(Boolean).join(', ');
}

function roomTypeLabel(roomType: Resource): string {
  const units = toNumber(roomType.attributes?.count_of_rooms);
  const title = text(roomType, 'title') ?? roomType.id;
  return units === null ? title : `${title} (${plural(units, 'unit')})`;
}

function names(items: Resource[], label: (item: Resource) => string): string | null {
  return items.length ? items.map(label).join('; ') : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value);
  return null;
}

/** Channex reads prices back as decimals, such as "150.00". */
function toMinor(value: unknown, currency: string): number | null {
  const amount = toNumber(value);
  return amount === null ? null : Math.round(amount * 10 ** minorDigits(currency));
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "Wed 11 Aug 2027". */
function longDate(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
    .formatToParts(new Date(`${date}T00:00:00Z`))
    .filter((part) => part.type !== 'literal')
    .map((part) => part.value)
    .join(' ');
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
