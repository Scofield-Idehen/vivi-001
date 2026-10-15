import {
  amenity,
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
  /** Amenity codes. The photos themselves stay with the panel: files can't be kept in a saved draft. */
  amenities: string[];
  title: string;
  summary: string;
  basePrice: string;
  cleaningFee: string;
}

export const STEPS = [
  { id: 'place', title: 'The place' },
  { id: 'name', title: 'Name and address' },
  { id: 'rooms', title: 'Guests and rooms' },
  { id: 'amenities', title: 'Amenities' },
  { id: 'photos', title: 'Photos' },
  { id: 'description', title: 'Title and description' },
  { id: 'pricing', title: 'Pricing' },
  { id: 'review', title: 'Check and add' },
] as const;
export type StepId = (typeof STEPS)[number]['id'];

/** The steps fall into three stages, as Airbnb's do: the place, what makes it stand out, the rest. */
export const STAGES: { title: string; steps: StepId[] }[] = [
  { title: 'About the place', steps: ['place', 'name', 'rooms'] },
  { title: 'Make it stand out', steps: ['amenities', 'photos', 'description'] },
  { title: 'Finish up', steps: ['pricing', 'review'] },
];

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
    amenities: [],
    title: '',
    summary: '',
    basePrice: '',
    cleaningFee: '',
  };
}

export function isDirty(draft: PropertyDraft): boolean {
  const fresh = newDraft(draft.countryCode);
  return (Object.keys(fresh) as (keyof PropertyDraft)[]).some(
    (key) => JSON.stringify(fresh[key]) !== JSON.stringify(draft[key]),
  );
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

export interface PriceErrors {
  minPrice?: string;
  maxPrice?: string;
  basePrice?: string;
  cleaningFee?: string;
}

export function priceErrors(draft: PropertyDraft, currency: string): PriceErrors {
  const min = priceToMinor(draft.minPrice, currency);
  const max = priceToMinor(draft.maxPrice, currency);
  const base = priceToMinor(draft.basePrice, currency);
  const cleaning = priceToMinor(draft.cleaningFee, currency);
  const errors: PriceErrors = {};
  if (base.error) errors.basePrice = base.error;
  if (cleaning.error) errors.cleaningFee = cleaning.error;
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

const moneyOf = (minor: number, currency: string, locale: string) =>
  formatMoney({ amountMinor: minor, currency }, locale).replace(/\.00$/, '');

/** "£120 to £340 a night", "From £120 a night", or null when no limits are set or they don't make sense yet. */
export function limitsText(d: PropertyDraft, currency: string, locale: string): string | null {
  const errors = priceErrors(d, currency);
  if (errors.minPrice || errors.maxPrice) return null;
  const min = priceToMinor(d.minPrice, currency).minor;
  const max = priceToMinor(d.maxPrice, currency).minor;
  if (min && max) return `${moneyOf(min, currency, locale)} to ${moneyOf(max, currency, locale)} a night`;
  if (min) return `From ${moneyOf(min, currency, locale)} a night`;
  if (max) return `Up to ${moneyOf(max, currency, locale)} a night`;
  return null;
}

export function priceOwnerText(d: PropertyDraft): string {
  return d.priceOwner === 'pricelabs' ? 'Prices from PriceLabs' : `Prices set in ${V01}`;
}

/** "£180 a night, £60 cleaning", or null until a price is typed. */
export function usualPriceText(d: PropertyDraft, currency: string, locale: string): string | null {
  const base = priceToMinor(d.basePrice, currency).minor;
  const cleaning = priceToMinor(d.cleaningFee, currency).minor;
  const parts = [
    base ? `${moneyOf(base, currency, locale)} a night` : null,
    cleaning ? `${moneyOf(cleaning, currency, locale)} cleaning` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** "Hot tub, Sea view and 4 more": standout features first, as guests see them. */
export function amenitiesText(codes: string[], shown = 2): string | null {
  const items = codes
    .map((code) => amenity(code))
    .filter((a) => a !== undefined)
    .sort((a, b) => Number(b.category === 'standout') - Number(a.category === 'standout'));
  if (items.length === 0) return null;
  const named = items.slice(0, shown).map((a) => a.label);
  const rest = items.length - named.length;
  if (rest > 0) return `${named.join(', ')} and ${rest} more`;
  const last = named.pop();
  return named.length ? `${named.join(', ')} and ${last}` : (last ?? null);
}

// The kind of place as a title starts it: "3-bedroom cottage", "Studio", "Serviced apartment".
const TITLE_KINDS: Partial<Record<PropertyType, string>> = {
  house: 'house',
  flat: 'flat',
  cottage: 'cottage',
  cabin: 'cabin',
  studio: 'studio',
  serviced_apartment: 'serviced apartment',
};

// What a standout feature reads as after "with".
const FEATURE_PHRASES: Record<string, string> = {
  hot_tub: 'a hot tub',
  pool: 'a pool',
  sauna: 'a sauna',
  sea_view: 'sea views',
  countryside_view: 'countryside views',
  mountain_view: 'mountain views',
  lake_view: 'water views',
  beach_access: 'beach access',
  log_burner: 'a log burner',
  open_fire: 'an open fire',
  garden: 'a garden',
  bbq: 'a barbecue',
  fire_pit: 'a fire pit',
  games_room: 'a games room',
  home_cinema: 'a home cinema',
  ev_charger: 'an EV charger',
  gym: 'a gym',
};

/**
 * A first title made from the answers so far, for people who would rather edit than start from
 * nothing: "3-bedroom cottage in Port Seton with a hot tub". Always within Airbnb's limit.
 */
export function suggestTitle(d: PropertyDraft, max: number): string | null {
  const kind = d.propertyType ? TITLE_KINDS[d.propertyType] : undefined;
  if (!kind) return null;
  const sized = d.bedrooms >= 2 && kind !== 'studio' ? `${d.bedrooms}-bedroom ${kind}` : kind;
  const where = d.area.trim() || d.city.trim();
  const feature = d.amenities.map((code) => FEATURE_PHRASES[code]).find(Boolean);
  const tries = [
    [sized, where && `in ${where}`, feature && `with ${feature}`],
    [sized, where && `in ${where}`],
    [sized, feature && `with ${feature}`],
    [sized],
  ];
  for (const parts of tries) {
    const text = parts.filter(Boolean).join(' ');
    if (text.length <= max) return text.charAt(0).toUpperCase() + text.slice(1);
  }
  return null;
}

/** One line under each step in the panel's step list, once there is something to say. */
export function stepSummary(
  step: StepId,
  d: PropertyDraft,
  visited: boolean,
  currency: string,
  locale: string,
  photoCount = 0,
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
    case 'amenities':
      return amenitiesText(d.amenities) ?? (visited ? 'None picked yet' : null);
    case 'photos':
      return photoCount ? plural(photoCount, 'photo') : visited ? 'None yet' : null;
    case 'description':
      return d.title.trim() || null;
    case 'pricing': {
      if (!visited) return null;
      const owner = d.priceOwner === 'pricelabs' ? 'PriceLabs' : `Set in ${V01}`;
      const base = priceToMinor(d.basePrice, currency).minor;
      if (base) return `${owner}, ${moneyOf(base, currency, locale)} a night`;
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
  const base = priceToMinor(d.basePrice, currency).minor;
  const cleaning = priceToMinor(d.cleaningFee, currency).minor;
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
    title: text(d.title),
    summary: text(d.summary),
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value) (input as Record<string, unknown>)[key] = value;
  }
  if (d.amenities.length) input.amenities = d.amenities;
  if (min) input.minPriceMinor = min;
  if (max) input.maxPriceMinor = max;
  if (base) input.basePriceMinor = base;
  if (cleaning) input.cleaningFeeMinor = cleaning;
  return input;
}

// Keeping the draft --------------------------------------------------------------------------------

export interface SavedDraft {
  draft: PropertyDraft;
  step: number;
  visited: number[];
  /** Photos chosen so far. The files can't be saved, so a reload asks for them again. */
  photoCount?: number;
}

// v2 since the panel gained amenities, photos and the description; older drafts start afresh.
const draftKey = (orgId: string) => `v01.newProperty.v2.${orgId}`;

/** A draft kept in this browser, so closing the panel never loses anything. */
export function loadDraft(orgId: string): SavedDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(orgId));
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedDraft;
    if (typeof saved?.draft?.name !== 'string' || typeof saved.step !== 'number') return null;
    // Anything added to the draft since it was saved starts at its default.
    return { ...saved, draft: { ...newDraft(saved.draft.countryCode ?? 'GB'), ...saved.draft } };
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
