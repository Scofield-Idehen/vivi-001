import type { Session } from '@supabase/supabase-js';
import {
  type Channel,
  type ConsoleOperator,
  type ConsoleOperatorDetail,
  type ConsoleOperatorList,
  type ConsoleOverview,
  type ConsoleSync,
  type ConsoleSyncRow,
  can,
  type Me,
  type MemberRole,
  type Permission,
  type Property,
  PropertyCreateSchema,
  type PropertyList,
  type PropertyType,
  SUPPORT_ROLE,
  SupportAccessStartSchema,
  type SupportGrant,
  type SupportGrantList,
  type SupportVisitList,
  type Workspace,
  type WorkspaceRole,
} from '@v01/shared';
import { ApiError } from './errors.ts';

/**
 * Demo mode's stand-in for the API. It answers the same routes with the same shapes and
 * error messages, using sample data kept in this browser, so the real screens can be tried
 * without a database or sign-in. Vivistays is the real first operator, empty until its
 * Guesty import; Northwind Stays and Brightwater Lets are invented, as are their people
 * and properties. The demo user is a V-01 owner and a Vivistays admin.
 */

const DEMO_USER = { id: '0b0c4a9e-1f6d-4c3e-9a8b-7d6e5f4a3b2c', email: 'demo@example.com' };

export const DEMO_SESSION = {
  access_token: 'demo',
  token_type: 'bearer',
  user: { id: DEMO_USER.id, email: DEMO_USER.email },
} as unknown as Session;

interface DemoTeamMember {
  email: string;
  fullName: string | null;
  role: MemberRole;
  status: 'active' | 'invited';
  sinceDaysAgo: number;
  lastSeenMinutesAgo: number | null;
}

/** Sample figures for the console, kept as "minutes ago" so they always look current. */
interface DemoLive {
  outboxWaiting: number;
  outboxFailed: number;
  oldestWaitingMinutes: number | null;
  lastSentMinutes: number | null;
  webhooksWaiting: number;
  webhooksFailed: number;
  lastWebhookMinutes: number | null;
  arrivalsToday: number;
  departuresToday: number;
  bookingsLast7Days: number;
  lastActivityMinutes: number | null;
}

interface DemoOperator {
  workspace: Omit<Workspace, 'role'>;
  /** The demo user's own role here; null where they can only get in with support access. */
  role: MemberRole | null;
  properties: Property[];
  createdAt: string;
  team: DemoTeamMember[];
  channelAccounts: { channel: Channel; connected: boolean }[];
  live: DemoLive;
}

interface DemoGrant {
  id: string;
  organisationId: string;
  staffEmail: string;
  reason: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  requests: number;
}

interface DemoSyncError {
  source: 'outbox' | 'webhook';
  organisationId: string | null;
  minutesAgo: number;
  attempts: number;
  message: string;
}

interface DemoState {
  /** Raised whenever the shape changes, so a browser holding older sample data starts fresh. */
  version: 3;
  operators: DemoOperator[];
  grants: DemoGrant[];
  unmatchedWebhooks: { waiting: number; failed: number; lastMinutes: number | null };
  errors: DemoSyncError[];
}

const STORAGE_KEY = 'v01.demo.state';
const VIVISTAYS = '6a1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const NORTHWIND = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';
const BRIGHTWATER = 'c3b2a190-8f7e-4d6c-9b5a-4e3d2c1b0a99';
const MINUTE = 60_000;

const ago = (minutes: number) => new Date(Date.now() - minutes * MINUTE).toISOString();
const agoOrNull = (minutes: number | null) => (minutes === null ? null : ago(minutes));

const NO_ACTIVITY: DemoLive = {
  outboxWaiting: 0,
  outboxFailed: 0,
  oldestWaitingMinutes: null,
  lastSentMinutes: null,
  webhooksWaiting: 0,
  webhooksFailed: 0,
  lastWebhookMinutes: null,
  arrivalsToday: 0,
  departuresToday: 0,
  bookingsLast7Days: 0,
  lastActivityMinutes: null,
};

function sampleProperty(p: {
  name: string;
  code: string;
  area: string;
  type: PropertyType;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  guests: number;
  prices: [number, number] | null;
  managedBy: Property['managedBy'];
}): Property {
  return {
    id: crypto.randomUUID(),
    name: p.name,
    internalCode: p.code,
    addressLine1: null,
    city: null,
    postcode: null,
    countryCode: 'GB',
    area: p.area,
    propertyType: p.type,
    spaceType: 'entire_place',
    bedrooms: p.bedrooms,
    beds: p.beds,
    bathrooms: p.bathrooms,
    maxGuests: p.guests,
    checkInTime: '15:00',
    checkOutTime: '10:00',
    managedBy: p.managedBy,
    priceOwner: 'v01',
    minPriceMinor: p.prices ? p.prices[0] : null,
    maxPriceMinor: p.prices ? p.prices[1] : null,
    createdAt: new Date('2026-10-14T09:00:00Z').toISOString(),
  };
}

function operatorWorkspace(
  id: string,
  name: string,
  legalName: string | null,
  slug: string,
  accentHex: string,
) {
  return {
    organisation: { id, name, legalName, slug },
    settings: { currency: 'GBP', timeZone: 'Europe/London', locale: 'en-GB', countryCode: 'GB' },
    brand: {
      displayName: name,
      logoLightUrl: null,
      logoDarkUrl: null,
      accentHex,
      senderName: name,
      emailDomain: null,
    },
  };
}

function seed(): DemoState {
  const pastVisit = Date.now() - (2 * 24 * 60 + 190) * MINUTE;
  return {
    version: 3,
    operators: [
      {
        role: 'admin',
        workspace: operatorWorkspace(VIVISTAYS, 'Vivistays', null, 'vivistays', '#1E4D4F'),
        // Empty on purpose: Vivistays' real properties arrive from the Guesty export in Phase 1.
        properties: [],
        createdAt: '2026-10-14T09:00:00.000Z',
        team: [
          {
            email: DEMO_USER.email,
            fullName: 'Demo user',
            role: 'admin',
            status: 'active',
            sinceDaysAgo: 0,
            lastSeenMinutesAgo: 0,
          },
        ],
        channelAccounts: [],
        live: NO_ACTIVITY,
      },
      {
        role: null,
        workspace: operatorWorkspace(
          NORTHWIND,
          'Northwind Stays',
          'Northwind Stays (fictional demo operator)',
          'northwind-demo',
          '#2F5E8C',
        ),
        properties: [
          sampleProperty({
            name: 'Harbour View Lodge',
            code: 'HVL',
            area: 'Harbourside',
            type: 'house',
            bedrooms: 3,
            beds: 4,
            bathrooms: 2,
            guests: 6,
            prices: [12_000, 34_000],
            managedBy: 'v01',
          }),
          sampleProperty({
            name: 'Mill Street Flat',
            code: 'MSF',
            area: 'Old Town',
            type: 'flat',
            bedrooms: 1,
            beds: 1,
            bathrooms: 1,
            guests: 2,
            prices: [6_500, 15_000],
            managedBy: 'v01',
          }),
          sampleProperty({
            name: 'Orchard Cottage',
            code: 'ORC',
            area: 'Riverside',
            type: 'cottage',
            bedrooms: 2,
            beds: 3,
            bathrooms: 1.5,
            guests: 4,
            prices: [9_000, 22_000],
            managedBy: 'guesty',
          }),
          sampleProperty({
            name: 'The Granary',
            code: 'GRN',
            area: 'Riverside',
            type: 'unusual',
            bedrooms: 4,
            beds: 5,
            bathrooms: 2.5,
            guests: 8,
            prices: null,
            managedBy: 'guesty',
          }),
        ],
        createdAt: '2026-09-02T10:00:00.000Z',
        team: [
          {
            email: 'jordan@northwind.example',
            fullName: 'Jordan Ellis',
            role: 'admin',
            status: 'active',
            sinceDaysAgo: 42,
            lastSeenMinutesAgo: 12,
          },
          {
            email: 'sam@northwind.example',
            fullName: 'Sam Patel',
            role: 'operations',
            status: 'active',
            sinceDaysAgo: 40,
            lastSeenMinutesAgo: 5,
          },
          {
            email: 'alex@northwind.example',
            fullName: 'Alex Morgan',
            role: 'guest_comms',
            status: 'active',
            sinceDaysAgo: 35,
            lastSeenMinutesAgo: 95,
          },
          {
            email: 'chris@northwind.example',
            fullName: 'Chris Doyle',
            role: 'field',
            status: 'active',
            sinceDaysAgo: 21,
            lastSeenMinutesAgo: 60 * 26,
          },
        ],
        channelAccounts: [
          { channel: 'airbnb', connected: true },
          { channel: 'airbnb', connected: true },
          { channel: 'booking_com', connected: true },
          { channel: 'vrbo', connected: false },
        ],
        live: {
          outboxWaiting: 2,
          outboxFailed: 1,
          oldestWaitingMinutes: 1,
          lastSentMinutes: 2,
          webhooksWaiting: 0,
          webhooksFailed: 0,
          lastWebhookMinutes: 14,
          arrivalsToday: 2,
          departuresToday: 1,
          bookingsLast7Days: 9,
          lastActivityMinutes: 5,
        },
      },
      {
        role: null,
        workspace: operatorWorkspace(
          BRIGHTWATER,
          'Brightwater Lets',
          'Brightwater Lets (fictional demo operator)',
          'brightwater-demo',
          '#7A4A2B',
        ),
        properties: [
          sampleProperty({
            name: 'Quay House',
            code: 'QYH',
            area: 'Quayside',
            type: 'house',
            bedrooms: 3,
            beds: 4,
            bathrooms: 2,
            guests: 6,
            prices: [11_000, 28_000],
            managedBy: 'guesty',
          }),
          sampleProperty({
            name: 'Linden Court, Flat 2',
            code: 'LC2',
            area: 'Town centre',
            type: 'flat',
            bedrooms: 2,
            beds: 2,
            bathrooms: 1,
            guests: 4,
            prices: [8_000, 18_000],
            managedBy: 'guesty',
          }),
          sampleProperty({
            name: 'The Old Bakery',
            code: 'OBK',
            area: 'Village',
            type: 'cottage',
            bedrooms: 2,
            beds: 3,
            bathrooms: 1.5,
            guests: 5,
            prices: null,
            managedBy: 'guesty',
          }),
        ],
        createdAt: '2026-10-08T11:30:00.000Z',
        team: [
          {
            email: 'taylor@brightwater.example',
            fullName: 'Taylor Reed',
            role: 'admin',
            status: 'active',
            sinceDaysAgo: 6,
            lastSeenMinutesAgo: 190,
          },
          {
            email: 'ops@brightwater.example',
            fullName: null,
            role: 'operations',
            status: 'invited',
            sinceDaysAgo: 2,
            lastSeenMinutesAgo: null,
          },
        ],
        channelAccounts: [
          { channel: 'airbnb', connected: false },
          { channel: 'booking_com', connected: false },
        ],
        live: { ...NO_ACTIVITY, lastActivityMinutes: 190 },
      },
    ],
    grants: [
      {
        id: crypto.randomUUID(),
        organisationId: NORTHWIND,
        staffEmail: 'support@v01.example',
        reason: 'Owner reported a double booking for 3 Nov. Checking both stays.',
        startedAt: new Date(pastVisit).toISOString(),
        expiresAt: new Date(pastVisit + 30 * MINUTE).toISOString(),
        endedAt: new Date(pastVisit + 18 * MINUTE).toISOString(),
        requests: 6,
      },
    ],
    unmatchedWebhooks: { waiting: 1, failed: 0, lastMinutes: 41 },
    errors: [
      {
        source: 'outbox',
        organisationId: NORTHWIND,
        minutesAgo: 26,
        attempts: 5,
        message:
          'Channex answered 422 for Harbour View Lodge, 24 Dec 2026: the minimum stay is longer than the rate plan allows.',
      },
      {
        source: 'webhook',
        organisationId: null,
        minutesAgo: 41,
        attempts: 3,
        message: 'Channex property 7f3a-sample is not mapped to any V-01 property yet.',
      },
    ],
  };
}

let state: DemoState | null = null;

function load(): DemoState {
  if (state) return state;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as DemoState;
      if (parsed.version === 3) {
        state = parsed;
        return parsed;
      }
    }
  } catch {
    // No storage (private window, blocked site data): the demo still works, it just forgets.
  }
  state = seed();
  return state;
}

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // See load().
  }
}

/** Puts the sample data back the way it started. */
export function resetDemoData(): void {
  state = seed();
  save();
}

// Access ----------------------------------------------------------------------------------------

function isOpen(g: DemoGrant, now = Date.now()): boolean {
  return g.endedAt === null && Date.parse(g.expiresAt) > now;
}

function findOperator(orgId: string | null | undefined): DemoOperator | undefined {
  return load().operators.find((o) => o.workspace.organisation.id === orgId);
}

/** The same checks as the API: membership first, then an open support grant (read-only, logged). */
function access(
  orgId: string | null | undefined,
  permission: Permission,
): { operator: DemoOperator; role: WorkspaceRole } {
  if (!orgId) throw new ApiError(400, 'workspace_required', 'Choose a workspace first.');
  const operator = findOperator(orgId);
  if (!operator) throw new ApiError(403, 'not_a_member', 'You are not a member of this workspace.');
  if (operator.role) {
    if (!can(operator.role, permission))
      throw new ApiError(403, 'not_allowed', 'Your role does not allow this.');
    return { operator, role: operator.role };
  }
  const grant = load().grants.find(
    (g) => g.organisationId === orgId && g.staffEmail === DEMO_USER.email && isOpen(g),
  );
  if (!grant) throw new ApiError(403, 'not_a_member', 'You are not a member of this workspace.');
  grant.requests += 1;
  save();
  if (!can(SUPPORT_ROLE, permission)) {
    throw new ApiError(403, 'support_read_only', 'Support access is read-only.');
  }
  return { operator, role: SUPPORT_ROLE };
}

// Console figures ------------------------------------------------------------------------------

function onV01(o: DemoOperator): number {
  return o.properties.filter((p) => p.managedBy === 'v01').length;
}

function onGuesty(o: DemoOperator): number {
  return o.properties.filter((p) => p.managedBy === 'guesty').length;
}

function lastActivity(o: DemoOperator): string | null {
  const times = [
    ...(o.live.lastActivityMinutes === null ? [] : [Date.now() - o.live.lastActivityMinutes * MINUTE]),
    ...o.properties.map((p) => Date.parse(p.createdAt)).filter((t) => t > Date.parse(o.createdAt)),
  ];
  return times.length ? new Date(Math.max(...times)).toISOString() : null;
}

function toConsoleOperator(o: DemoOperator): ConsoleOperator {
  const id = o.workspace.organisation.id;
  const connected = o.channelAccounts.filter((a) => a.connected);
  return {
    id,
    name: o.workspace.organisation.name,
    slug: o.workspace.organisation.slug,
    createdAt: o.createdAt,
    status: onV01(o) > 0 ? 'live' : 'onboarding',
    properties: o.properties.length,
    propertiesOnV01: onV01(o),
    propertiesOnGuesty: onGuesty(o),
    members: o.team.filter((m) => m.status === 'active').length,
    channelAccounts: o.channelAccounts.length,
    channelAccountsConnected: connected.length,
    channels: [...new Set(connected.map((a) => a.channel))].sort(),
    outboxWaiting: o.live.outboxWaiting,
    outboxFailed: o.live.outboxFailed,
    webhooksFailed: o.live.webhooksFailed,
    lastActivityAt: lastActivity(o),
    supportActive: load().grants.some((g) => g.organisationId === id && isOpen(g)),
  };
}

function toGrant(g: DemoGrant): SupportGrant {
  return {
    ...g,
    organisationName: findOperator(g.organisationId)?.workspace.organisation.name ?? 'Unknown operator',
    active: isOpen(g),
  };
}

function grantsNewestFirst(orgId?: string): DemoGrant[] {
  return load()
    .grants.filter((g) => !orgId || g.organisationId === orgId)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

function overview(): ConsoleOverview {
  const s = load();
  const sum = (pick: (l: DemoLive) => number) => s.operators.reduce((n, o) => n + pick(o.live), 0);
  const lastSent = s.operators.map((o) => o.live.lastSentMinutes).filter((m): m is number => m !== null);
  return {
    operators: s.operators.length,
    operatorsLive: s.operators.filter((o) => onV01(o) > 0).length,
    properties: s.operators.reduce((n, o) => n + o.properties.length, 0),
    propertiesOnV01: s.operators.reduce((n, o) => n + onV01(o), 0),
    propertiesOnGuesty: s.operators.reduce((n, o) => n + onGuesty(o), 0),
    arrivalsToday: sum((l) => l.arrivalsToday),
    departuresToday: sum((l) => l.departuresToday),
    bookingsLast7Days: sum((l) => l.bookingsLast7Days),
    outboxWaiting: sum((l) => l.outboxWaiting),
    outboxFailed: sum((l) => l.outboxFailed),
    webhooksWaiting: sum((l) => l.webhooksWaiting) + s.unmatchedWebhooks.waiting,
    webhooksFailed: sum((l) => l.webhooksFailed) + s.unmatchedWebhooks.failed,
    supportSessionsActive: s.grants.filter((g) => isOpen(g)).length,
    lastSentAt: lastSent.length ? ago(Math.min(...lastSent)) : null,
    generatedAt: new Date().toISOString(),
  };
}

function sync(): ConsoleSync {
  const s = load();
  const rows: ConsoleSyncRow[] = [...s.operators]
    .sort((a, b) => a.workspace.organisation.name.localeCompare(b.workspace.organisation.name))
    .map((o) => ({
      organisationId: o.workspace.organisation.id,
      organisationName: o.workspace.organisation.name,
      outboxWaiting: o.live.outboxWaiting,
      outboxFailed: o.live.outboxFailed,
      oldestWaitingAt: agoOrNull(o.live.oldestWaitingMinutes),
      lastSentAt: agoOrNull(o.live.lastSentMinutes),
      webhooksWaiting: o.live.webhooksWaiting,
      webhooksFailed: o.live.webhooksFailed,
      lastWebhookAt: agoOrNull(o.live.lastWebhookMinutes),
    }));
  if (s.unmatchedWebhooks.waiting + s.unmatchedWebhooks.failed > 0) {
    rows.push({
      organisationId: null,
      organisationName: null,
      outboxWaiting: 0,
      outboxFailed: 0,
      oldestWaitingAt: null,
      lastSentAt: null,
      webhooksWaiting: s.unmatchedWebhooks.waiting,
      webhooksFailed: s.unmatchedWebhooks.failed,
      lastWebhookAt: agoOrNull(s.unmatchedWebhooks.lastMinutes),
    });
  }
  return {
    rows,
    errors: [...s.errors]
      .sort((a, b) => a.minutesAgo - b.minutesAgo)
      .map((e) => ({
        source: e.source,
        organisationId: e.organisationId,
        organisationName: findOperator(e.organisationId)?.workspace.organisation.name ?? null,
        at: ago(e.minutesAgo),
        attempts: e.attempts,
        message: e.message,
      })),
    generatedAt: new Date().toISOString(),
  };
}

function operatorDetail(orgId: string): ConsoleOperatorDetail {
  const o = findOperator(orgId);
  if (!o) throw new ApiError(404, 'operator_not_found', 'There is no operator with that id.');
  return {
    operator: {
      ...toConsoleOperator(o),
      legalName: o.workspace.organisation.legalName,
      displayName: o.workspace.brand.displayName,
      currency: o.workspace.settings.currency,
      timeZone: o.workspace.settings.timeZone,
      countryCode: o.workspace.settings.countryCode,
    },
    team: [...o.team]
      .sort((a, b) =>
        a.status === b.status ? a.email.localeCompare(b.email) : a.status === 'active' ? -1 : 1,
      )
      .map((m) => ({
        email: m.email,
        fullName: m.fullName,
        role: m.role,
        status: m.status,
        since: ago(m.sinceDaysAgo * 24 * 60),
        lastSeenAt: agoOrNull(m.lastSeenMinutesAgo),
      })),
    support: grantsNewestFirst(orgId).slice(0, 20).map(toGrant),
  };
}

// Routes ---------------------------------------------------------------------------------------

const pause = () => new Promise((resolve) => setTimeout(resolve, 120));
const OPERATOR_PATH = /^\/v1\/console\/operators\/([0-9a-f-]{36})$/;
const START_PATH = /^\/v1\/console\/operators\/([0-9a-f-]{36})\/support-access$/;
const END_PATH = /^\/v1\/console\/support-access\/([0-9a-f-]{36})\/end$/;

export async function demoFetch<T>(
  path: string,
  options: { orgId?: string | null; method?: 'GET' | 'POST'; body?: unknown },
): Promise<T> {
  await pause();
  const method = options.method ?? 'GET';
  const s = load();

  if (method === 'GET' && path === '/v1/me') {
    const me: Me = {
      user: { id: DEMO_USER.id, email: DEMO_USER.email, fullName: 'Demo user' },
      memberships: s.operators
        .filter((o) => o.role !== null)
        .map((o) => ({
          organisationId: o.workspace.organisation.id,
          organisationName: o.workspace.organisation.name,
          role: o.role as MemberRole,
        })),
      platformRole: 'owner',
      supportAccess: s.grants
        .filter((g) => g.staffEmail === DEMO_USER.email && isOpen(g))
        .map((g) => ({
          grantId: g.id,
          organisationId: g.organisationId,
          organisationName: findOperator(g.organisationId)?.workspace.organisation.name ?? '',
          expiresAt: g.expiresAt,
        })),
    };
    return me as T;
  }

  if (method === 'GET' && path === '/v1/workspace') {
    const { operator, role } = access(options.orgId, 'workspace.read');
    return { ...operator.workspace, role } as T;
  }

  if (method === 'GET' && path === '/v1/workspace/support-visits') {
    const { operator } = access(options.orgId, 'workspace.read');
    const visits: SupportVisitList = {
      visits: grantsNewestFirst(operator.workspace.organisation.id).map((g) => ({
        id: g.id,
        staffEmail: g.staffEmail,
        reason: g.reason,
        startedAt: g.startedAt,
        expiresAt: g.expiresAt,
        endedAt: g.endedAt,
      })),
    };
    return visits as T;
  }

  if (method === 'GET' && path === '/v1/properties') {
    const { operator } = access(options.orgId, 'properties.read');
    const list: PropertyList = {
      properties: [...operator.properties].sort((a, b) => a.name.localeCompare(b.name)),
    };
    return list as T;
  }

  if (method === 'POST' && path === '/v1/properties') {
    const { operator } = access(options.orgId, 'properties.write');
    const parsed = PropertyCreateSchema.safeParse(options.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ApiError(400, 'invalid_request', `${issue?.path.join('.') || 'request'}: ${issue?.message}`);
    }
    const input = parsed.data;
    if (input.internalCode && operator.properties.some((p) => p.internalCode === input.internalCode)) {
      throw new ApiError(409, 'code_in_use', `Another property already uses ${input.internalCode}.`);
    }
    const created: Property = {
      id: crypto.randomUUID(),
      name: input.name,
      internalCode: input.internalCode ?? null,
      addressLine1: input.addressLine1 ?? null,
      city: input.city ?? null,
      postcode: input.postcode ?? null,
      countryCode: input.countryCode,
      area: input.area ?? null,
      propertyType: input.propertyType ?? null,
      spaceType: input.spaceType ?? 'entire_place',
      bedrooms: input.bedrooms ?? null,
      beds: input.beds ?? null,
      bathrooms: input.bathrooms ?? null,
      maxGuests: input.maxGuests,
      checkInTime: input.checkInTime ?? '15:00',
      checkOutTime: input.checkOutTime ?? '10:00',
      // Added in V-01, so nothing is connected yet (the API does the same).
      managedBy: 'none',
      priceOwner: input.priceOwner ?? 'v01',
      minPriceMinor: input.minPriceMinor ?? null,
      maxPriceMinor: input.maxPriceMinor ?? null,
      createdAt: new Date().toISOString(),
    };
    operator.properties.push(created);
    save();
    return created as T;
  }

  // The V-01 console: the demo user is a V-01 owner.
  if (method === 'GET' && path === '/v1/console/overview') return overview() as T;
  if (method === 'GET' && path === '/v1/console/operators') {
    const list: ConsoleOperatorList = {
      operators: [...s.operators]
        .sort((a, b) => a.workspace.organisation.name.localeCompare(b.workspace.organisation.name))
        .map(toConsoleOperator),
    };
    return list as T;
  }
  const operatorMatch = OPERATOR_PATH.exec(path);
  if (method === 'GET' && operatorMatch?.[1]) return operatorDetail(operatorMatch[1]) as T;
  if (method === 'GET' && path === '/v1/console/sync') return sync() as T;
  if (method === 'GET' && path === '/v1/console/support') {
    const log: SupportGrantList = { grants: grantsNewestFirst().map(toGrant) };
    return log as T;
  }

  const startMatch = START_PATH.exec(path);
  if (method === 'POST' && startMatch?.[1]) {
    const orgId = startMatch[1];
    if (!findOperator(orgId))
      throw new ApiError(404, 'operator_not_found', 'There is no operator with that id.');
    const parsed = SupportAccessStartSchema.safeParse(options.body);
    if (!parsed.success) {
      throw new ApiError(400, 'invalid_request', parsed.error.issues[0]?.message ?? 'Check the request.');
    }
    const now = Date.now();
    for (const g of s.grants) {
      if (g.organisationId === orgId && g.staffEmail === DEMO_USER.email && isOpen(g, now)) {
        g.endedAt = new Date(now).toISOString();
      }
    }
    const grant: DemoGrant = {
      id: crypto.randomUUID(),
      organisationId: orgId,
      staffEmail: DEMO_USER.email,
      reason: parsed.data.reason,
      startedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + parsed.data.minutes * MINUTE).toISOString(),
      endedAt: null,
      requests: 0,
    };
    s.grants.push(grant);
    save();
    return toGrant(grant) as T;
  }

  const endMatch = END_PATH.exec(path);
  if (method === 'POST' && endMatch?.[1]) {
    const grant = s.grants.find((g) => g.id === endMatch[1]);
    if (!grant || !isOpen(grant)) return { ended: false } as T;
    grant.endedAt = new Date().toISOString();
    save();
    return { ended: true } as T;
  }

  throw new ApiError(404, 'not_found', 'No such endpoint.');
}
