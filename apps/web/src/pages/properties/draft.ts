import {
  formatMoney,
  PROPERTY_TYPE_LABELS,
  type PriceOwner,
  type PropertyCreate,
  type PropertyType,
  parseMajorToMinor,
  SPACE_TYPE_LABELS,
  type SpaceType,
} from '@v01/shared';
import { plural, V01 } from '../../lib/format.ts';

/** Everything the new-property panel asks, as typed. Numbers that people type stay strings until the end. */
export interface PropertyDraft {
  propertyType: PropertyType | null;
  spaceType: SpaceType;
  name: string;
  internalCode: string;
  /** True once someone types their own code; from then on the code stops following the name. */
  codeEdited: boolean;
  addressLine1: string;
  city: string;
  postcode: string;
  area: string;
  countryCode: string;
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  checkInTime: string;
  checkOutTime: string;
  priceOwner: PriceOwner;
  minPrice: string;
  maxPrice: string;
}

export const STEPS = [
  { id: 'place', title: 'The place' },
  { id: 'name', title: 'Name and address' },
  { id: 'rooms', title: 'Guests and rooms' },
  { id: 'pricing', title: 'Pricing' },
  { id: 'review', title: 'Check and add' },
] as const;
export type StepId = (typeof STEPS)[number]['id'];

export function newDraft(countryCode: string): PropertyDraft {
  return {
    propertyType: null,
    spaceType: 'entire_place',
    name: '',
    internalCode: '',
    codeEdited: false,
    addressLine1: '',
    city: '',
    postcode: '',
    area: '',
    countryCode,
    maxGuests: 2,
    bedrooms: 1,
    beds: 1,
    bathrooms: 1,
    checkInTime: '15:00',
    checkOutTime: '10:00',
    priceOwner: 'v01',
    minPrice: '',
    maxPrice: '',
  };
}

export function isDirty(draft: PropertyDraft): boolean {
  const fresh = newDraft(draft.countryCode);
  return (Object.keys(fresh) as (keyof PropertyDraft)[]).some((key) => fresh[key] !== draft[key]);
}

/** Half-hour times for the check-in and check-out lists. */
export const TIMES = Array.from(
  { length: 48 },
  (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`,
);

/** Countries offered first in the address; the operator's own country is always included. */
export function countryOptions(own: string): { code: string; name: string }[] {
  const names = new Intl.DisplayNames(['en-GB'], { type: 'region' });
  const codes = [...new Set([own, 'GB', 'IE', 'FR', 'ES', 'PT', 'IT', 'NL', 'DE', 'US'])];
  return codes.map((code) => ({ code, name: names.of(code) ?? code }));
}

// Prices ---------------------------------------------------------------------------------------

/** "£120", "120.50" or "1,200" become minor units. Empty is fine: limits can be added later. */
export function priceToMinor(value: string, currency: string): { minor?: number; error?: string } {
  const cleaned = value.replace(/[£$€,\s]/g, '');
  if (!cleaned) return {};
  try {
    const minor = parseMajorToMinor(cleaned, currency);
    if (minor <= 0) return { error: 'Enter an amount above zero' };
    return { minor };
  } catch {
    return { error: 'Enter an amount such as 120 or 120.50' };
  }
}

export function priceErrors(
  draft: PropertyDraft,
  currency: string,
): { minPrice?: string; maxPrice?: string } {
  const min = priceToMinor(draft.minPrice, currency);
  const max = priceToMinor(draft.maxPrice, currency);
  const errors: { minPrice?: string; maxPrice?: string } = {};
  if (min.error) errors.minPrice = min.error;
  if (max.error) errors.maxPrice = max.error;
  if (!errors.minPrice && !errors.maxPrice && min.minor && max.minor && min.minor > max.minor) {
    errors.minPrice = 'The lowest price is above the highest';
  }
  return errors;
}

// Words ----------------------------------------------------------------------------------------

function bathroomsText(n: number): string {
  const shown = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(n);
  return `${shown} ${n === 1 ? 'bathroom' : 'bathrooms'}`;
}

/** "6 guests, 3 bedrooms, 4 beds and 2 bathrooms". */
export function roomsText(d: PropertyDraft): string {
  return `${plural(d.maxGuests, 'guest')}, ${plural(d.bedrooms, 'bedroom')}, ${plural(d.beds, 'bed')} and ${bathroomsText(d.bathrooms)}`;
}

/** "Cottage, the whole place". */
export function placeText(d: PropertyDraft): string | null {
  if (!d.propertyType) return null;
  return `${PROPERTY_TYPE_LABELS[d.propertyType]}, ${SPACE_TYPE_LABELS[d.spaceType].toLowerCase()}`;
}

export function addressText(d: PropertyDraft): string {
  return [d.addressLine1, d.area, d.city, d.postcode]
    .map((p) => p.trim())
    .filter(Boolean)
    .join(', ');
}

/** "£120 to £340 a night", "From £120 a night", or null when no limits are set or they don't make sense yet. */
export function limitsText(d: PropertyDraft, currency: string, locale: string): string | null {
  if (Object.keys(priceErrors(d, currency)).length > 0) return null;
  const min = priceToMinor(d.minPrice, currency).minor;
  const max = priceToMinor(d.maxPrice, currency).minor;
  const money = (minor: number) => formatMoney({ amountMinor: minor, currency }, locale).replace(/\.00$/, '');
  if (min && max) return `${money(min)} to ${money(max)} a night`;
  if (min) return `From ${money(min)} a night`;
  if (max) return `Up to ${money(max)} a night`;
  return null;
}

export function priceOwnerText(d: PropertyDraft): string {
  return d.priceOwner === 'pricelabs' ? 'Prices from PriceLabs' : `Prices set in ${V01}`;
}

/** One line under each step in the panel's step list, once there is something to say. */
export function stepSummary(
  step: StepId,
  d: PropertyDraft,
  visited: boolean,
  currency: string,
  locale: string,
): string | null {
  switch (step) {
    case 'place':
      return placeText(d);
    case 'name':
      return d.name.trim()
        ? [d.name.trim(), d.city.trim() || d.area.trim()].filter(Boolean).join(', ')
        : null;
    case 'rooms':
      return visited ? `${plural(d.maxGuests, 'guest')}, ${plural(d.bedrooms, 'bedroom')}` : null;
    case 'pricing': {
      if (!visited) return null;
      const owner = d.priceOwner === 'pricelabs' ? 'PriceLabs' : `Set in ${V01}`;
      const limits = limitsText(d, currency, locale);
      return limits ? `${owner}, ${limits.replace(' a night', '')}` : owner;
    }
    default:
      return null;
  }
}

/** The create request, once the one thing that can't be defaulted (the name) is there. */
export function toCreate(d: PropertyDraft, currency: string): PropertyCreate {
  const text = (value: string) => value.trim() || undefined;
  const min = priceToMinor(d.minPrice, currency).minor;
  const max = priceToMinor(d.maxPrice, currency).minor;
  const input: PropertyCreate = {
    name: d.name.trim(),
    countryCode: d.countryCode,
    maxGuests: d.maxGuests,
    spaceType: d.spaceType,
    bedrooms: d.bedrooms,
    beds: d.beds,
    bathrooms: d.bathrooms,
    checkInTime: d.checkInTime,
    checkOutTime: d.checkOutTime,
    priceOwner: d.priceOwner,
  };
  if (d.propertyType) input.propertyType = d.propertyType;
  const optional = {
    internalCode: text(d.internalCode),
    addressLine1: text(d.addressLine1),
    city: text(d.city),
    postcode: text(d.postcode),
    area: text(d.area),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value) (input as Record<string, unknown>)[key] = value;
  }
  if (min) input.minPriceMinor = min;
  if (max) input.maxPriceMinor = max;
  return input;
}

// Keeping the draft --------------------------------------------------------------------------------

export interface SavedDraft {
  draft: PropertyDraft;
  step: number;
  visited: number[];
}

const draftKey = (orgId: string) => `v01.newProperty.${orgId}`;

/** A draft kept in this browser, so closing the panel never loses anything. */
export function loadDraft(orgId: string): SavedDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(orgId));
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedDraft;
    if (typeof saved?.draft?.name !== 'string' || typeof saved.step !== 'number') return null;
    return saved;
  } catch {
    return null;
  }
}

export function saveDraft(orgId: string, saved: SavedDraft): void {
  try {
    localStorage.setItem(draftKey(orgId), JSON.stringify(saved));
  } catch {
    // Storage can be unavailable (private windows); the draft then lasts until the panel closes.
  }
}

export function clearDraft(orgId: string): void {
  try {
    localStorage.removeItem(draftKey(orgId));
  } catch {
    // See saveDraft.
  }
}
