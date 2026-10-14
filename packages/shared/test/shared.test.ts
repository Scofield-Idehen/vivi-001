import { describe, expect, it } from 'vitest';
import {
  addDays,
  can,
  eachNight,
  formatMoney,
  isIsoDate,
  minorToMajorString,
  nightsBetween,
  PropertyCreateSchema,
  parseMajorToMinor,
  staysOverlap,
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
});

describe('property input', () => {
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
