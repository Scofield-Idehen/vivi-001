import { describe, expect, it } from 'vitest';
import {
  AMENITIES,
  AmenityCodesSchema,
  addDays,
  CalendarChangeSchema,
  CalendarQuerySchema,
  can,
  canPlatform,
  countBeds,
  countSleeps,
  eachNight,
  formatMoney,
  isIsoDate,
  isoWeekday,
  isWeekendNight,
  listingChecklist,
  minorToMajorString,
  nightRules,
  nightsBetween,
  PERMISSIONS,
  PropertyCreateSchema,
  PropertyUpdateSchema,
  parseMajorToMinor,
  ReservationUpdateSchema,
  SupportAccessStartSchema,
  selectedNights,
  staysOverlap,
  suggestPropertyCode,
  todayIn,
} from '../src/index.ts';

describe('money', () => {
  it('parses decimal strings into minor units', () => {
    expect(parseMajorToMinor('142.50', 'GBP')).toBe(14250);
    expect(parseMajorToMinor('142.5', 'GBP')).toBe(14250);
    expect(parseMajorToMinor('142', 'GBP')).toBe(14200);
    expect(parseMajorToMinor('9000', 'JPY')).toBe(9000);
  });

  it('refuses more decimal places than the currency allows', () => {
    expect(() => parseMajorToMinor('1.005', 'GBP')).toThrow();
    expect(() => parseMajorToMinor('12.5', 'JPY')).toThrow();
    expect(() => parseMajorToMinor('abc', 'GBP')).toThrow();
  });

  it('round-trips minor units to decimal strings', () => {
    expect(minorToMajorString(14250, 'GBP')).toBe('142.50');
    expect(minorToMajorString(5, 'GBP')).toBe('0.05');
    expect(minorToMajorString(-1999, 'EUR')).toBe('-19.99');
    expect(minorToMajorString(9000, 'JPY')).toBe('9000');
  });

  it('formats for display', () => {
    expect(formatMoney({ amountMinor: 14250, currency: 'GBP' })).toBe('£142.50');
  });
});

describe('dates', () => {
  it('validates real calendar dates only', () => {
    expect(isIsoDate('2026-11-13')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('13/11/2026')).toBe(false);
  });

  it('counts nights across month and year ends', () => {
    expect(nightsBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(eachNight('2026-11-13', '2026-11-15')).toEqual(['2026-11-13', '2026-11-14']);
  });

  it('treats check-out day as free for the next arrival', () => {
    const first = { checkIn: '2026-11-10', checkOut: '2026-11-14' };
    expect(staysOverlap(first, { checkIn: '2026-11-14', checkOut: '2026-11-16' })).toBe(false);
    expect(staysOverlap(first, { checkIn: '2026-11-13', checkOut: '2026-11-16' })).toBe(true);
  });

  it("gives today's date in the property's time zone", () => {
    const lateEvening = new Date('2026-11-13T23:30:00Z');
    expect(todayIn('Europe/London', lateEvening)).toBe('2026-11-13');
    expect(todayIn('Asia/Tokyo', lateEvening)).toBe('2026-11-14');
  });
});

describe('permissions', () => {
  it('lets operations edit properties but not manage the workspace', () => {
    expect(can('operations', 'properties.write')).toBe(true);
    expect(can('operations', 'workspace.manage')).toBe(false);
    expect(can('field', 'properties.read')).toBe(false);
    expect(can('admin', 'members.manage')).toBe(true);
  });

  it('lets V-01 support read a workspace but never change anything in it', () => {
    for (const [permission, roles] of Object.entries(PERMISSIONS)) {
      const allowed = (roles as readonly string[]).includes('v01_support');
      expect(allowed, permission).toBe(permission.endsWith('.read'));
    }
  });

  it('keeps the console to V-01 staff, and support access to owners and support', () => {
    expect(canPlatform(null, 'console.read')).toBe(false);
    expect(canPlatform('viewer', 'console.read')).toBe(true);
    expect(canPlatform('viewer', 'support.open')).toBe(false);
    expect(canPlatform('viewer', 'console.team.read')).toBe(false);
    expect(canPlatform('support', 'support.open')).toBe(true);
  });

  it('asks for a reason and a sensible length of time before support access opens', () => {
    expect(SupportAccessStartSchema.safeParse({ reason: '  hi ', minutes: 30 }).success).toBe(false);
    expect(SupportAccessStartSchema.safeParse({ reason: 'Ticket 12', minutes: 300 }).success).toBe(false);
    expect(SupportAccessStartSchema.parse({ reason: ' Ticket 12 ', minutes: 30 })).toEqual({
      reason: 'Ticket 12',
      minutes: 30,
    });
  });
});

describe('property codes', () => {
  it('suggests a short code from the name', () => {
    expect(suggestPropertyCode('Harbour View Lodge')).toBe('HVL');
    expect(suggestPropertyCode('The Granary')).toBe('GRA');
    expect(suggestPropertyCode('Linden Court, Flat 2')).toBe('LCF2');
    expect(suggestPropertyCode('  ')).toBe('');
  });

  it('adds a number when the code is taken', () => {
    expect(suggestPropertyCode('Harbour View Lodge', ['HVL', 'hvl2'])).toBe('HVL3');
  });
});

describe('property input', () => {
  it('takes bathrooms in halves only', () => {
    const base = { name: 'Quay House', countryCode: 'GB', maxGuests: 4 };
    expect(PropertyCreateSchema.safeParse({ ...base, bathrooms: 1.5 }).success).toBe(true);
    expect(PropertyCreateSchema.safeParse({ ...base, bathrooms: 1.25 }).success).toBe(false);
  });

  it('rejects a minimum price above the maximum', () => {
    const result = PropertyCreateSchema.safeParse({
      name: 'Harbour View Lodge',
      countryCode: 'gb',
      maxGuests: 6,
      minPriceMinor: 20000,
      maxPriceMinor: 10000,
    });
    expect(result.success).toBe(false);
  });

  it('normalises the country code', () => {
    const result = PropertyCreateSchema.parse({ name: 'Mill Street Flat', countryCode: 'gb', maxGuests: 2 });
    expect(result.countryCode).toBe('GB');
  });
});

describe('the listing', () => {
  it('keeps every amenity code unique, and refuses ones not on the list', () => {
    const codes = AMENITIES.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(AmenityCodesSchema.parse(['wifi', 'hot_tub', 'wifi'])).toEqual(['wifi', 'hot_tub']);
    expect(AmenityCodesSchema.safeParse(['wifi', 'moat']).success).toBe(false);
  });

  it('counts beds the way channels show them, and how many they sleep', () => {
    const rooms = [
      { beds: [{ type: 'king' as const, count: 1 }] },
      {
        beds: [
          { type: 'bunk_bed' as const, count: 1 },
          { type: 'cot' as const, count: 1 },
        ],
      },
      {
        beds: [
          { type: 'sofa_bed' as const, count: 1 },
          { type: 'single' as const, count: 2 },
        ],
      },
    ];
    expect(countBeds(rooms)).toBe(5);
    expect(countSleeps(rooms)).toBe(8);
  });

  it('lists what a listing still needs before it goes on a channel', () => {
    const empty = listingChecklist({
      photos: [],
      title: null,
      summary: null,
      amenities: [],
      rooms: [],
      addressLine1: null,
      city: 'Port Seton',
      postcode: null,
      checkInMethod: null,
      priceOwner: 'v01',
      basePriceMinor: null,
    });
    expect(empty.filter((c) => c.done)).toEqual([]);
    expect(empty[0]).toMatchObject({ section: 'photos', note: 'Add 5 more, at least 5 in all' });

    const ready = listingChecklist({
      photos: [1, 2, 3, 4, 5, 6],
      title: 'Seaside house with a hot tub',
      summary: 'Two minutes from the beach.',
      amenities: ['wifi', 'hot_tub', 'garden'],
      rooms: [{ beds: [{ type: 'double', count: 1 }] }],
      addressLine1: '3 Carnoustie Drive',
      city: 'Port Seton',
      postcode: 'EH32 0TB',
      checkInMethod: 'keypad',
      priceOwner: 'pricelabs',
      basePriceMinor: null,
    });
    expect(ready.every((c) => c.done)).toBe(true);
  });

  it('takes a change to any part of a listing, but nothing contradictory', () => {
    expect(PropertyUpdateSchema.safeParse({ title: 'x'.repeat(51) }).success).toBe(false);
    expect(PropertyUpdateSchema.safeParse({ minNights: 7, maxNights: 3 }).success).toBe(false);
    expect(PropertyUpdateSchema.safeParse({ quietHoursStart: '22:00', quietHoursEnd: null }).success).toBe(
      false,
    );
    expect(PropertyUpdateSchema.safeParse({}).success).toBe(false);
    expect(PropertyUpdateSchema.parse({ licenceNumber: ' EL00123F ' })).toEqual({
      licenceNumber: 'EL00123F',
    });
  });
});

describe('the calendar', () => {
  const usual = {
    basePriceMinor: 15_000,
    weekendPriceMinor: 19_000,
    minPriceMinor: 9_500,
    maxPriceMinor: 40_000,
    minNights: 2,
    maxNights: null,
  };
  const own = (patch: Partial<Parameters<typeof nightRules>[2] & object> = {}) => ({
    priceMinor: null,
    minNights: null,
    closedToArrival: false,
    closedToDeparture: false,
    ...patch,
  });

  it('counts the week from Monday, and takes Friday and Saturday nights as the weekend', () => {
    expect(isoWeekday('2026-10-19')).toBe(1);
    expect(isoWeekday('2026-10-25')).toBe(7);
    expect(['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'].map(isWeekendNight)).toEqual([
      false,
      true,
      true,
      false,
    ]);
    expect(selectedNights('2026-10-19', '2026-11-01', [5, 6])).toEqual([
      '2026-10-23',
      '2026-10-24',
      '2026-10-30',
      '2026-10-31',
    ]);
    expect(selectedNights('2026-12-31', '2027-01-01')).toEqual(['2026-12-31', '2027-01-01']);
  });

  it("uses the usual price, the weekend price on Fridays and Saturdays, or the night's own", () => {
    expect(nightRules(usual, '2026-10-21')).toMatchObject({ priceMinor: 15_000, priceFrom: 'usual' });
    expect(nightRules(usual, '2026-10-23')).toMatchObject({ priceMinor: 19_000, priceFrom: 'weekend' });
    expect(nightRules(usual, '2026-10-23', own({ priceMinor: 21_000 }))).toMatchObject({
      priceMinor: 21_000,
      priceFrom: 'night',
      heldAt: null,
    });
    expect(nightRules({ ...usual, weekendPriceMinor: null }, '2026-10-23').priceFrom).toBe('usual');
    expect(
      nightRules({ ...usual, basePriceMinor: null, weekendPriceMinor: null }, '2026-10-21'),
    ).toMatchObject({ priceMinor: null, priceFrom: null });
  });

  it('never goes outside the price limits', () => {
    expect(nightRules({ ...usual, basePriceMinor: 8_000 }, '2026-10-21')).toMatchObject({
      priceMinor: 9_500,
      heldAt: 'lowest',
    });
    expect(nightRules(usual, '2026-10-23', own({ priceMinor: 55_000 }))).toMatchObject({
      priceMinor: 40_000,
      heldAt: 'highest',
    });
  });

  it("takes the night's own minimum stay and closed dates over the usual ones", () => {
    expect(nightRules(usual, '2026-10-21')).toMatchObject({
      minNights: 2,
      minNightsFrom: 'usual',
      closedToArrival: false,
      closedToDeparture: false,
    });
    expect(
      nightRules(usual, '2026-10-21', own({ minNights: 4, closedToArrival: true, closedToDeparture: true })),
    ).toMatchObject({ minNights: 4, minNightsFrom: 'night', closedToArrival: true, closedToDeparture: true });
  });

  it('reads up to two months at a time, and changes up to a year', () => {
    expect(CalendarQuerySchema.safeParse({ from: '2026-11-01', to: '2026-12-31' }).success).toBe(true);
    expect(CalendarQuerySchema.safeParse({ from: '2026-11-01', to: '2027-01-02' }).success).toBe(false);
    expect(CalendarQuerySchema.safeParse({ from: '2026-11-02', to: '2026-11-01' }).success).toBe(false);
    const change = { propertyIds: ['8f7c1a52-2b1e-4c55-9a2a-3c1f0d9e7b11'], firstNight: '2026-11-01' };
    expect(CalendarChangeSchema.safeParse({ ...change, lastNight: '2027-11-01', minNights: 3 }).success).toBe(
      true,
    );
    expect(CalendarChangeSchema.safeParse({ ...change, lastNight: '2027-11-02', minNights: 3 }).success).toBe(
      false,
    );
    expect(CalendarChangeSchema.safeParse({ ...change, lastNight: '2026-11-02' }).success).toBe(false);
    expect(
      CalendarChangeSchema.safeParse({ ...change, lastNight: '2026-11-02', daysOfWeek: [0], blocked: true })
        .success,
    ).toBe(false);
  });
});

describe('changing a booking', () => {
  it('takes tidied contact details, agreed times and notes', () => {
    expect(
      ReservationUpdateSchema.parse({
        guestName: '  Hannah Lee ',
        guestEmail: ' hannah@guest.example ',
        guestPhone: '+44 7700 900123',
        checkInTime: '13:00',
        notes: ' Early arrival agreed ',
      }),
    ).toEqual({
      guestName: 'Hannah Lee',
      guestEmail: 'hannah@guest.example',
      guestPhone: '+44 7700 900123',
      checkInTime: '13:00',
      notes: 'Early arrival agreed',
    });
    // Empty clears a detail; null puts a time back to the property's.
    expect(ReservationUpdateSchema.parse({ guestEmail: '', checkOutTime: null })).toEqual({
      guestEmail: '',
      checkOutTime: null,
    });
  });

  it('refuses what is not an email, a phone number or a time, and an empty change', () => {
    expect(ReservationUpdateSchema.safeParse({ guestEmail: 'hannah at home' }).success).toBe(false);
    expect(ReservationUpdateSchema.safeParse({ guestPhone: 'call me' }).success).toBe(false);
    expect(ReservationUpdateSchema.safeParse({ guestPhone: '12-34' }).success).toBe(false);
    expect(ReservationUpdateSchema.safeParse({ checkInTime: '3pm' }).success).toBe(false);
    expect(ReservationUpdateSchema.safeParse({ notes: 'x'.repeat(4001) }).success).toBe(false);
    expect(ReservationUpdateSchema.safeParse({}).success).toBe(false);
  });
});
