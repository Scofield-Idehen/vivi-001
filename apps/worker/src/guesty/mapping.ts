import type {
  GuestyCalendarDay,
  GuestyIntegration,
  GuestyListing,
  GuestyPost,
  GuestyReservation,
} from '@v01/integrations';
import {
  AMENITIES,
  addDays,
  type Channel,
  MESSAGE_MAX,
  type MessageVia,
  minorDigits,
  type PropertyType,
  type ReservationStatus,
} from '@v01/shared';

/**
 * Guesty's words into V-01's, with nothing invented: a value Guesty doesn't give stays null, and
 * anything that can't be mapped is reported rather than dropped quietly. Pure functions, tested on
 * their own; the import (import.ts) does the database work.
 */

export interface OrgDefaults {
  currency: string;
  countryCode: string;
  timeZone: string;
}

/** Guesty's channel names (its "platform" values) as V-01 names them. */
export function channelOf(platform: string | null | undefined): Channel | null {
  const p = (platform ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (p === 'airbnb' || p === 'airbnb2') return 'airbnb';
  if (p === 'bookingcom' || p === 'booking') return 'booking_com';
  if (p === 'homeaway' || p === 'homeaway2' || p === 'vrbo') return 'vrbo';
  if (p === 'expedia') return 'expedia';
  return null;
}

/** A booking's channel: a channel Guesty connected, or direct for manual, website and the rest. */
export function reservationChannel(r: GuestyReservation): Channel {
  return channelOf(r.integration?.platform ?? r.platform ?? r.source) ?? 'direct';
}

const COUNTRY_CODES: Record<string, string> = {
  'united kingdom': 'GB',
  uk: 'GB',
  'great britain': 'GB',
  britain: 'GB',
  england: 'GB',
  scotland: 'GB',
  wales: 'GB',
  'northern ireland': 'GB',
  ireland: 'IE',
  'united states': 'US',
  usa: 'US',
  'united states of america': 'US',
  france: 'FR',
  spain: 'ES',
  portugal: 'PT',
  italy: 'IT',
  germany: 'DE',
  netherlands: 'NL',
  nigeria: 'NG',
  greece: 'GR',
  croatia: 'HR',
  australia: 'AU',
  canada: 'CA',
};

/** "United Kingdom", "GB" or "gb" → "GB"; null when nothing is recognisable. */
export function countryCodeOf(country: string | null | undefined): string | null {
  if (!country) return null;
  const trimmed = country.trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  return COUNTRY_CODES[trimmed.toLowerCase()] ?? null;
}

/** Guesty's property types (Airbnb's words) as V-01's shorter list. */
export function propertyTypeOf(type: string | null | undefined): PropertyType | null {
  const t = (type ?? '').toLowerCase();
  if (!t) return null;
  if (/apartment|condo|flat|loft|penthouse/.test(t))
    return t.includes('serviced') ? 'serviced_apartment' : 'flat';
  if (/house|villa|townhouse|bungalow|chalet|farm|lodge/.test(t)) return 'house';
  if (/cabin/.test(t)) return 'cabin';
  if (/cottage/.test(t)) return 'cottage';
  if (/studio/.test(t)) return 'studio';
  if (/yurt|treehouse|boat|barn|castle|tent|dome|tiny|hut|cave|lighthouse|windmill/.test(t)) return 'unusual';
  return 'other';
}

/** Guesty's room types (Airbnb's words) as V-01's. */
export function spaceTypeOf(
  roomType: string | null | undefined,
): 'entire_place' | 'private_room' | 'shared_room' {
  const r = (roomType ?? '').toLowerCase();
  if (r.includes('shared')) return 'shared_room';
  if (r.includes('private')) return 'private_room';
  return 'entire_place';
}

/**
 * Guesty keeps amenities as Airbnb's names. Each pattern below names the V-01 code it means; a
 * name no pattern matches is reported so the list can grow.
 */
const AMENITY_PATTERNS: [RegExp, string][] = [
  [/^(wireless internet|wifi|wi-fi|internet)$/, 'wifi'],
  [/fast wifi|high.?speed/, 'fast_wifi'],
  [/^kitchen$/, 'kitchen'],
  [/washer|washing machine/, 'washing_machine'],
  [/^dryer$|tumble dryer/, 'tumble_dryer'],
  [/drying rack|clothes airer/, 'drying_rack'],
  [/^heating$|central heating/, 'central_heating'],
  [/underfloor/, 'underfloor_heating'],
  [/air.?conditioning/, 'air_conditioning'],
  [/^fans?$|ceiling fan|portable fan/, 'fans'],
  [/^tv$|^cable tv$|television|smart tv/, 'tv'],
  [/netflix|streaming|amazon prime|disney/, 'streaming'],
  [/sound system|speaker|bluetooth/, 'sound_system'],
  [/hot tub|jacuzzi/, 'hot_tub'],
  [/^pool$|swimming pool|private pool|shared pool/, 'pool'],
  [/sauna/, 'sauna'],
  [/^gym$|fitness/, 'gym'],
  [/free parking on premises|free parking on the|driveway|private parking/, 'free_parking'],
  [/street parking/, 'street_parking'],
  [/paid parking/, 'paid_parking'],
  [/garage/, 'garage'],
  [/elevator|^lift$/, 'lift'],
  [/^iron$|ironing/, 'iron'],
  [/hair.?dryer/, 'hairdryer'],
  [/hangers/, 'hangers'],
  [/shampoo|shower gel|body soap/, 'shampoo'],
  [/toiletries|essentials/, 'toiletries'],
  [/smoke (detector|alarm)/, 'smoke_alarm'],
  [/carbon monoxide/, 'co_alarm'],
  [/fire extinguisher/, 'fire_extinguisher'],
  [/fire blanket/, 'fire_blanket'],
  [/first aid/, 'first_aid_kit'],
  [/dishwasher/, 'dishwasher'],
  [/microwave/, 'microwave'],
  [/refrigerator|fridge/, 'fridge'],
  [/freezer/, 'freezer'],
  [/^oven$/, 'oven'],
  [/^stove$|^hob$|cooker/, 'hob'],
  [/coffee (maker|machine)|nespresso|espresso/, 'coffee_machine'],
  [/kettle/, 'kettle'],
  [/toaster/, 'toaster'],
  [/dishes and silverware|crockery|cutlery/, 'crockery_cutlery'],
  [/cooking basics/, 'cooking_basics'],
  [/dining table/, 'dining_table'],
  [/bed linens?|bedding/, 'bed_linen'],
  [/towels/, 'towels'],
  [/extra pillows/, 'extra_pillows'],
  [/room.darkening|blackout/, 'blackout_blinds'],
  [/wardrobe|closet|drawers/, 'wardrobe'],
  [/^crib$|^cot$|travel cot|pack .n play/, 'cot'],
  [/high chair/, 'high_chair'],
  [/baby (safety )?gates|stair gates/, 'stair_gates'],
  [/children.s books|toys|outdoor play|playground/, 'outdoor_play'],
  [/board games/, 'board_games'],
  [/^books$|reading material/, 'books'],
  [/game console|games console|playstation|xbox/, 'games_console'],
  [/bbq|barbecue|grill/, 'bbq'],
  [/fire pit/, 'fire_pit'],
  [/patio|balcony|terrace/, 'patio'],
  [/outdoor (furniture|dining|seating)/, 'outdoor_furniture'],
  [/garden|backyard|yard/, 'garden'],
  [/beach(front| access| view)?$/, 'beach_access'],
  [/waterfront/, 'waterfront'],
  [/lake access|lake view|river view/, 'lake_view'],
  [/sea view|ocean view/, 'sea_view'],
  [/mountain view/, 'mountain_view'],
  [/countryside|garden view|valley view/, 'countryside_view'],
  [/indoor fireplace|open fire|fireplace/, 'open_fire'],
  [/log burner|wood.?burn|stove burner/, 'log_burner'],
  [/laptop.friendly|workspace|dedicated work|desk/, 'workspace'],
  [/luggage drop/, 'luggage_drop'],
  [/long.?term stays/, 'long_stays'],
  [/self check.?in|keypad|lockbox|smart lock/, 'self_check_in'],
  [/bathtub|^bath$/, 'bath'],
  [/walk.in shower|rain shower/, 'walk_in_shower'],
  [/heated towel/, 'heated_towel_rail'],
  [/hot water/, 'hot_water'],
  [/ev charger|electric vehicle|car charger/, 'ev_charger'],
  [/security camera|cctv/, 'outdoor_cameras'],
  [/step.free (access|entrance)|wheelchair accessible|no stairs/, 'step_free_entrance'],
  [/step.free shower|roll.in shower/, 'step_free_shower'],
  [/wide (doorway|entrance|hallway)/, 'wide_doorways'],
  [/grab rails|grab bars/, 'grab_rails'],
  [/ground floor bedroom|bedroom on ground/, 'ground_floor_bedroom'],
  [/bike storage|bicycle storage/, 'bike_storage'],
  [/boot room/, 'boot_room'],
  [/cleaning (available )?during stay/, 'cleaning_during_stay'],
  [/home (cinema|theat)|projector/, 'home_cinema'],
  [/games room|pool table|table tennis|ping pong/, 'games_room'],
];

const KNOWN_CODES = new Set(AMENITIES.map((a) => a.code));

/** Guesty amenity names → V-01 codes, and the names nothing matched. */
export function amenityCodes(names: readonly string[] | null | undefined): {
  codes: string[];
  unknown: string[];
} {
  const codes = new Set<string>();
  const unknown: string[] = [];
  for (const raw of names ?? []) {
    const name = raw.trim().toLowerCase();
    if (!name) continue;
    const hit = AMENITY_PATTERNS.find(([pattern]) => pattern.test(name));
    if (hit && KNOWN_CODES.has(hit[1])) codes.add(hit[1]);
    else unknown.push(raw.trim());
  }
  return { codes: [...codes].sort(), unknown };
}

/** A Guesty price (a number in the listing's currency, such as 150) in minor units, or null. */
export function minorOf(value: number | null | undefined, currency: string): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 10 ** minorDigits(currency));
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function timeOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = value.trim().slice(0, 5);
  return TIME.test(t) ? t : null;
}

function cut(value: string | null | undefined, max: number, warnings: string[], what: string): string | null {
  if (!value) return null;
  const text = value.trim();
  if (!text) return null;
  if (text.length <= max) return text;
  warnings.push(`${what} was cut to ${max} characters.`);
  return text.slice(0, max).trimEnd();
}

export interface MappedProperty {
  values: {
    name: string;
    title: string | null;
    summary: string | null;
    theSpace: string | null;
    guestAccess: string | null;
    neighbourhood: string | null;
    gettingAround: string | null;
    otherNotes: string | null;
    houseRules: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    postcode: string | null;
    countryCode: string;
    propertyType: PropertyType | null;
    spaceType: 'entire_place' | 'private_room' | 'shared_room';
    bedrooms: number | null;
    beds: number | null;
    bathrooms: number | null;
    maxGuests: number;
    /** Left out when Guesty gives none, so the property keeps V-01's usual time. */
    checkInTime?: string;
    checkOutTime?: string;
    minNights: number;
    maxNights: number | null;
    basePriceMinor: number | null;
    weekendPriceMinor: number | null;
    cleaningFeeMinor: number | null;
    extraGuestFeeMinor: number | null;
    extraGuestFrom: number | null;
    securityDepositMinor: number | null;
    petsAllowed: boolean;
    smokingAllowed: boolean;
    eventsAllowed: boolean;
    childrenAllowed: boolean;
    tags: string[];
  };
  amenities: string[];
  photos: { key: string; url: string; caption: string | null }[];
  /** Things the team should look at: unknown amenities, a cut title, a currency that differs. */
  warnings: string[];
}

/** A V-01 property from a Guesty listing. */
export function propertyFromListing(listing: GuestyListing, org: OrgDefaults): MappedProperty {
  const warnings: string[] = [];
  const currency = listing.prices?.currency?.toUpperCase() || org.currency;
  if (currency !== org.currency) {
    warnings.push(`Prices are in ${currency}; the workspace uses ${org.currency}. Check them.`);
  }
  const name =
    (listing.nickname ?? '').trim() || (listing.title ?? '').trim() || `Guesty listing ${listing._id}`;
  const countryCode = countryCodeOf(listing.address?.country) ?? org.countryCode;
  if (listing.address?.country && !countryCodeOf(listing.address.country)) {
    warnings.push(`Country "${listing.address.country}" wasn't recognised; ${org.countryCode} was used.`);
  }
  const { codes, unknown } = amenityCodes(listing.amenities);
  if (unknown.length) warnings.push(`Amenities without a match: ${unknown.join(', ')}.`);
  const minNights = Math.max(1, Math.min(365, listing.terms?.minNights ?? 1));
  const maxNightsRaw = listing.terms?.maxNights ?? null;
  const maxNights = maxNightsRaw && maxNightsRaw >= minNights ? maxNightsRaw : null;
  const guestsIncluded = listing.prices?.guestsIncludedInRegularFee ?? null;
  const extraGuestFeeMinor = minorOf(listing.prices?.extraPersonFee, currency);
  const maxGuests = Math.max(1, listing.accommodates ?? 1);
  if (!listing.accommodates) warnings.push('Guesty gives no guest count; 1 was used.');
  const bathrooms = listing.bathrooms ?? null;
  const halves = bathrooms === null ? null : Math.round(bathrooms * 2) / 2;

  const pictures = (listing.pictures ?? []).filter((p) => p.original || p.regular || p.thumbnail);
  const photos = pictures.map((p, i) => ({
    key: p._id ?? String(i),
    url: (p.original ?? p.regular ?? p.thumbnail) as string,
    caption: cut(p.caption, 200, warnings, `Photo ${i + 1}'s caption`),
  }));

  return {
    values: {
      name: cut(name, 120, warnings, 'The name') ?? name,
      title: cut(listing.title, 50, warnings, 'The listing title'),
      summary: cut(listing.publicDescription?.summary, 500, warnings, 'The summary'),
      theSpace: listing.publicDescription?.space?.trim() || null,
      guestAccess: listing.publicDescription?.access?.trim() || null,
      neighbourhood: listing.publicDescription?.neighborhood?.trim() || null,
      gettingAround: listing.publicDescription?.transit?.trim() || null,
      otherNotes: listing.publicDescription?.notes?.trim() || null,
      houseRules: listing.publicDescription?.houseRules?.trim() || null,
      addressLine1: listing.address?.street?.trim() || null,
      addressLine2: listing.address?.apt?.trim() || null,
      city: listing.address?.city?.trim() || null,
      postcode: listing.address?.zipcode?.trim() || null,
      countryCode,
      propertyType: propertyTypeOf(listing.propertyType),
      spaceType: spaceTypeOf(listing.roomType),
      bedrooms: listing.bedrooms ?? null,
      beds: listing.beds ?? null,
      bathrooms: halves,
      maxGuests,
      ...(timeOf(listing.defaultCheckInTime)
        ? { checkInTime: timeOf(listing.defaultCheckInTime) as string }
        : {}),
      ...(timeOf(listing.defaultCheckOutTime)
        ? { checkOutTime: timeOf(listing.defaultCheckOutTime) as string }
        : {}),
      minNights,
      maxNights,
      basePriceMinor: minorOf(listing.prices?.basePrice, currency),
      weekendPriceMinor: minorOf(listing.prices?.weekendBasePrice, currency),
      cleaningFeeMinor: minorOf(listing.prices?.cleaningFee, currency),
      extraGuestFeeMinor,
      extraGuestFrom: extraGuestFeeMinor && guestsIncluded && guestsIncluded > 0 ? guestsIncluded + 1 : null,
      securityDepositMinor: minorOf(listing.prices?.securityDepositFee, currency),
      petsAllowed: listing.houseRules?.petsAllowed ?? false,
      smokingAllowed: listing.houseRules?.smokingAllowed ?? false,
      eventsAllowed: listing.houseRules?.suitableForEvents ?? false,
      childrenAllowed: listing.houseRules?.suitableForChildren ?? true,
      tags: [...new Set((listing.tags ?? []).map((t) => t.trim()).filter(Boolean))].slice(0, 30),
    },
    amenities: codes,
    photos,
    warnings,
  };
}

/**
 * Which channel account a listing's integration belongs to. Guesty records the account differently
 * per channel; these are the places it has been seen. The import reports the key it used, and the
 * first real pull confirms it (docs/decisions.md).
 */
export function accountKeyOf(integration: GuestyIntegration): string {
  const candidates: unknown[] = [
    integration.accountId,
    integration.integrationAccountId,
    (integration.airbnb as Record<string, unknown> | undefined)?.hostId,
    (integration.airbnb as Record<string, unknown> | undefined)?.accountId,
    (integration.airbnb as Record<string, unknown> | undefined)?.userId,
    (integration.bookingCom as Record<string, unknown> | undefined)?.accountId,
    (integration.bookingCom as Record<string, unknown> | undefined)?.legalEntityId,
    (integration.homeaway as Record<string, unknown> | undefined)?.accountId,
    (integration.homeaway as Record<string, unknown> | undefined)?.advertiserId,
    integration.hostId,
    integration.userId,
  ];
  const found = candidates.find((c) => typeof c === 'string' && c.trim() !== '');
  return typeof found === 'string' ? found.trim() : 'unknown';
}

/** The listing's id on the channel, from wherever Guesty put it. */
export function externalListingIdOf(integration: GuestyIntegration): string | null {
  const candidates: unknown[] = [
    integration.externalId,
    (integration.airbnb as Record<string, unknown> | undefined)?.id,
    (integration.bookingCom as Record<string, unknown> | undefined)?.hotelId,
    (integration.homeaway as Record<string, unknown> | undefined)?.id,
    integration.listingId,
  ];
  const found = candidates.find((c) => (typeof c === 'string' && c.trim() !== '') || typeof c === 'number');
  return found === undefined ? null : String(found).trim();
}

export interface MappedReservation {
  status: ReservationStatus;
  channel: Channel;
  channelReference: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  infants: number;
  currency: string | null;
  totalMinor: number | null;
  payoutMinor: number | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  cancelledAt: string | null;
  guest: { fullName: string | null; email: string | null; phone: string | null } | null;
}

/** Guesty's reservation statuses as V-01's five. Stays that have ended ("closed") were confirmed. */
export function reservationStatusOf(status: string | null | undefined): ReservationStatus | null {
  switch ((status ?? '').toLowerCase()) {
    case 'confirmed':
    case 'closed':
    case 'checked_in':
    case 'checked_out':
      return 'confirmed';
    case 'reserved':
    case 'awaiting_payment':
      return 'request';
    case 'inquiry':
      return 'inquiry';
    case 'canceled':
    case 'cancelled':
    case 'declined':
    case 'expired':
      return 'cancelled';
    default:
      return null;
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A V-01 booking from a Guesty reservation, or why it can't be one. */
export function reservationFrom(
  r: GuestyReservation,
  org: OrgDefaults,
): { ok: true; value: MappedReservation } | { ok: false; reason: string } {
  const status = reservationStatusOf(r.status);
  if (!status) return { ok: false, reason: `status "${r.status}" has no place in V-01` };
  const checkIn = r.checkInDateLocalized ?? r.checkIn?.slice(0, 10) ?? null;
  const checkOut = r.checkOutDateLocalized ?? r.checkOut?.slice(0, 10) ?? null;
  if (!checkIn || !checkOut || !DATE.test(checkIn) || !DATE.test(checkOut) || checkOut <= checkIn) {
    return { ok: false, reason: `dates ${checkIn ?? '?'} to ${checkOut ?? '?'} don't make a stay` };
  }
  const channel = reservationChannel(r);
  const currency = r.money?.currency?.toUpperCase() ?? null;
  const party = r.numberOfGuests;
  const adults = Math.max(1, party?.numberOfAdults ?? r.guestsCount ?? 1);
  const guest = r.guest
    ? {
        fullName: r.guest.fullName?.trim() || null,
        email: r.guest.email?.trim().toLowerCase() || null,
        phone: r.guest.phone?.trim() || null,
      }
    : null;
  return {
    ok: true,
    value: {
      status,
      channel,
      // The channel's own code where there is one, so a booking Channex later sends is linked, not doubled.
      channelReference: r.confirmationCode?.trim() || `guesty:${r._id}`,
      checkIn,
      checkOut,
      adults,
      children: Math.max(0, party?.numberOfChildren ?? 0),
      infants: Math.max(0, party?.numberOfInfants ?? 0),
      currency,
      totalMinor: minorOf(r.money?.totalPrice, currency ?? org.currency),
      payoutMinor: minorOf(r.money?.hostPayout ?? r.money?.netIncome, currency ?? org.currency),
      checkInTime: timeOf(r.plannedArrival),
      checkOutTime: timeOf(r.plannedDeparture),
      cancelledAt: status === 'cancelled' ? (r.canceledAt ?? new Date().toISOString()) : null,
      guest: guest && (guest.fullName || guest.email || guest.phone) ? guest : null,
    },
  };
}

export interface CalendarChanges {
  /** Manual blocks, merged into runs; `endsOn` is the first free night, like a check-out. */
  blocks: { startsOn: string; endsOn: string; reason: string | null }[];
  /** Nights whose price, shortest stay or arrival/departure rules differ from the usual. */
  nights: {
    night: string;
    priceMinor: number | null;
    minNights: number | null;
    closedToArrival: boolean;
    closedToDeparture: boolean;
  }[];
}

/**
 * What a Guesty calendar adds to a property's usual rules: the nights someone blocked by hand, and
 * the nights priced or ruled on their own. Booked nights are left out; the bookings bring those.
 */
export function calendarChanges(
  days: GuestyCalendarDay[],
  usual: { basePriceMinor: number | null; weekendPriceMinor: number | null; minNights: number },
  currency: string,
): CalendarChanges {
  const blocks: CalendarChanges['blocks'] = [];
  const nights: CalendarChanges['nights'] = [];
  const sorted = [...days].filter((d) => DATE.test(d.date)).sort((a, b) => a.date.localeCompare(b.date));
  for (const day of sorted) {
    const manual =
      day.blocks?.m === true || (day.status === 'unavailable' && !day.blocks?.b && !day.blocks?.r);
    if (manual) {
      const current = blocks.at(-1);
      const note = day.note?.trim() || null;
      if (current && current.endsOn === day.date && current.reason === note)
        current.endsOn = addDays(day.date, 1);
      else blocks.push({ startsOn: day.date, endsOn: addDays(day.date, 1), reason: note });
    }
    const weekend = [5, 6].includes(new Date(`${day.date}T12:00:00Z`).getUTCDay());
    const usualPrice = weekend ? (usual.weekendPriceMinor ?? usual.basePriceMinor) : usual.basePriceMinor;
    const price = minorOf(day.price, currency);
    const ownPrice = day.isBasePrice === true ? null : price !== null && price !== usualPrice ? price : null;
    const ownMin =
      day.isBaseMinNights === true
        ? null
        : day.minNights && day.minNights !== usual.minNights && day.minNights >= 1 && day.minNights <= 365
          ? day.minNights
          : null;
    const cta = day.cta === true;
    const ctd = day.ctd === true;
    if (ownPrice !== null || ownMin !== null || cta || ctd) {
      nights.push({
        night: day.date,
        priceMinor: ownPrice,
        minNights: ownMin,
        closedToArrival: cta,
        closedToDeparture: ctd,
      });
    }
  }
  return { blocks, nights };
}

export interface MappedMessage {
  externalId: string;
  direction: 'in' | 'out';
  via: MessageVia;
  body: string;
  at: string;
  automatic: boolean;
}

/** An email's HTML as plain text: tags off, breaks kept, entities read, blank runs closed up. */
export function plainText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h\d)\b[^>]*>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * One message from Guesty's Inbox as a V-01 message, or null for what isn't a conversation: Guesty's
 * own log lines and the team's private notes. Where the message came by isn't always said, so the
 * booking's channel stands in (a direct booking's falls back to email).
 */
export function messageFromPost(post: GuestyPost, bookingVia: MessageVia): MappedMessage | null {
  const id = post._id ?? post.postId;
  const module = (post.module ?? '').toLowerCase();
  if (!id || module === 'log' || module === 'note' || module === 'notes') return null;
  const raw = post.body ?? '';
  const text = /<[a-z][\s\S]*>/i.test(raw) ? plainText(raw) : raw.trim();
  if (!text) return null;
  const type = (post.type ?? '').toLowerCase();
  const direction = type === 'fromhost' || type === 'fromguesty' ? 'out' : 'in';
  const viaOfModule: MessageVia | null =
    module.includes('sms') || module.includes('whatsapp')
      ? 'sms'
      : module.includes('email')
        ? 'email'
        : (channelOf(module) as MessageVia | null);
  const at = post.createdAt ?? post.sentAt;
  if (!at || Number.isNaN(Date.parse(at))) return null;
  return {
    externalId: `guesty:${id}`,
    direction,
    via: viaOfModule ?? bookingVia,
    body: text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX - 1)}…` : text,
    at: new Date(at).toISOString(),
    automatic: post.isAutomatic === true,
  };
}
