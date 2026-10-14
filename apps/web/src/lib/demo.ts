import type { Session } from '@supabase/supabase-js';
import {
  type Me,
  type MemberRole,
  type Property,
  PropertyCreateSchema,
  type PropertyList,
  type Workspace,
} from '@v01/shared';
import { ApiError } from './errors.ts';

/**
 * Demo mode's stand-in for the API. It answers the same routes with the same shapes and
 * error messages, using sample data kept in this browser, so the real screens can be tried
 * without a database or sign-in. All names and properties here are invented.
 */

const DEMO_USER = { id: '0b0c4a9e-1f6d-4c3e-9a8b-7d6e5f4a3b2c', email: 'demo@example.com' };

export const DEMO_SESSION = {
  access_token: 'demo',
  token_type: 'bearer',
  user: { id: DEMO_USER.id, email: DEMO_USER.email },
} as unknown as Session;

interface DemoOperator {
  workspace: Omit<Workspace, 'role'>;
  role: MemberRole;
  properties: Property[];
}

interface DemoState {
  version: 1;
  operators: DemoOperator[];
}

const STORAGE_KEY = 'v01.demo.state';

function sampleProperty(
  name: string,
  code: string,
  area: string,
  bedrooms: number,
  maxGuests: number,
  prices: [number, number] | null,
  managedBy: Property['managedBy'],
): Property {
  return {
    id: crypto.randomUUID(),
    name,
    internalCode: code,
    addressLine1: null,
    city: null,
    postcode: null,
    countryCode: 'GB',
    area,
    bedrooms,
    maxGuests,
    checkInTime: '15:00',
    checkOutTime: '10:00',
    managedBy,
    priceOwner: 'v01',
    minPriceMinor: prices ? prices[0] : null,
    maxPriceMinor: prices ? prices[1] : null,
    createdAt: new Date('2026-10-14T09:00:00Z').toISOString(),
  };
}

function seed(): DemoState {
  return {
    version: 1,
    operators: [
      {
        role: 'admin',
        workspace: {
          organisation: {
            id: '6a1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
            name: 'Vivistays',
            legalName: null,
            slug: 'vivistays',
          },
          settings: { currency: 'GBP', timeZone: 'Europe/London', locale: 'en-GB', countryCode: 'GB' },
          brand: {
            displayName: 'Vivistays',
            logoLightUrl: null,
            logoDarkUrl: null,
            accentHex: '#1E4D4F',
            senderName: 'Vivistays',
            emailDomain: null,
          },
        },
        // Empty on purpose: Vivistays' real properties arrive from the Guesty export in Phase 1.
        properties: [],
      },
      {
        role: 'admin',
        workspace: {
          organisation: {
            id: '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a',
            name: 'Northwind Stays',
            legalName: 'Northwind Stays (fictional demo operator)',
            slug: 'northwind-demo',
          },
          settings: { currency: 'GBP', timeZone: 'Europe/London', locale: 'en-GB', countryCode: 'GB' },
          brand: {
            displayName: 'Northwind Stays',
            logoLightUrl: null,
            logoDarkUrl: null,
            accentHex: '#2F5E8C',
            senderName: 'Northwind Stays',
            emailDomain: null,
          },
        },
        properties: [
          sampleProperty('Harbour View Lodge', 'HVL', 'Harbourside', 3, 6, [12_000, 34_000], 'v01'),
          sampleProperty('Mill Street Flat', 'MSF', 'Old Town', 1, 2, [6_500, 15_000], 'v01'),
          sampleProperty('Orchard Cottage', 'ORC', 'Riverside', 2, 4, [9_000, 22_000], 'guesty'),
          sampleProperty('The Granary', 'GRN', 'Riverside', 4, 8, null, 'guesty'),
        ],
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
      if (parsed.version === 1) {
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

function operator(orgId: string | null | undefined): DemoOperator {
  const found = load().operators.find((o) => o.workspace.organisation.id === orgId);
  if (!orgId) throw new ApiError(400, 'workspace_required', 'Choose a workspace first.');
  if (!found) throw new ApiError(403, 'not_a_member', 'You are not a member of this workspace.');
  return found;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 120));

export async function demoFetch<T>(
  path: string,
  options: { orgId?: string | null; method?: 'GET' | 'POST'; body?: unknown },
): Promise<T> {
  await pause();
  const method = options.method ?? 'GET';

  if (method === 'GET' && path === '/v1/me') {
    const me: Me = {
      user: { id: DEMO_USER.id, email: DEMO_USER.email, fullName: 'Demo user' },
      memberships: load().operators.map((o) => ({
        organisationId: o.workspace.organisation.id,
        organisationName: o.workspace.organisation.name,
        role: o.role,
      })),
    };
    return me as T;
  }

  if (method === 'GET' && path === '/v1/workspace') {
    const o = operator(options.orgId);
    return { ...o.workspace, role: o.role } as T;
  }

  if (method === 'GET' && path === '/v1/properties') {
    const list: PropertyList = {
      properties: [...operator(options.orgId).properties].sort((a, b) => a.name.localeCompare(b.name)),
    };
    return list as T;
  }

  if (method === 'POST' && path === '/v1/properties') {
    const o = operator(options.orgId);
    const parsed = PropertyCreateSchema.safeParse(options.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ApiError(400, 'invalid_request', `${issue?.path.join('.') || 'request'}: ${issue?.message}`);
    }
    const input = parsed.data;
    if (input.internalCode && o.properties.some((p) => p.internalCode === input.internalCode)) {
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
      bedrooms: input.bedrooms ?? null,
      maxGuests: input.maxGuests,
      checkInTime: input.checkInTime ?? '15:00',
      checkOutTime: input.checkOutTime ?? '10:00',
      managedBy: 'guesty',
      priceOwner: 'v01',
      minPriceMinor: input.minPriceMinor ?? null,
      maxPriceMinor: input.maxPriceMinor ?? null,
      createdAt: new Date().toISOString(),
    };
    o.properties.push(created);
    save();
    return created as T;
  }

  throw new ApiError(404, 'not_found', 'No such endpoint.');
}
