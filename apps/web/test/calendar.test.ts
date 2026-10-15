import type { Calendar, CalendarProperty } from '@v01/shared';
import { describe, expect, it } from 'vitest';
import {
  barFor,
  buildRows,
  type ChangeForm,
  monthSpans,
  newForm,
  nightsFrom,
  nightsThatFit,
  rangeLabel,
  resultMessage,
  selectionBetween,
  summarise,
  toChange,
  windowLabel,
} from '../src/pages/calendar/model.ts';

const TODAY = '2026-10-15';

const property = (patch: Partial<CalendarProperty>): CalendarProperty => ({
  id: crypto.randomUUID(),
  name: 'Harbour View Lodge',
  internalCode: 'HVL',
  coverPhotoUrl: null,
  managedBy: 'v01',
  priceOwner: 'v01',
  basePriceMinor: 16_500,
  weekendPriceMinor: 19_500,
  minPriceMinor: 12_000,
  maxPriceMinor: 34_000,
  minNights: 2,
  maxNights: null,
  ...patch,
});

const lodge = property({});
const flat = property({
  name: 'Mill Street Flat',
  internalCode: 'MSF',
  managedBy: 'guesty',
  priceOwner: 'pricelabs',
  basePriceMinor: 8_500,
  weekendPriceMinor: null,
  minPriceMinor: null,
  maxPriceMinor: null,
  minNights: 1,
});

// Tuesday 13 to Monday 26 October 2026: two days before today, then twelve ahead.
const nights = nightsFrom('2026-10-13', 14);

const calendar: Calendar = {
  from: '2026-10-13',
  to: '2026-10-26',
  today: TODAY,
  properties: [lodge, flat],
  nights: [
    {
      propertyId: lodge.id,
      night: '2026-10-20',
      priceMinor: 21_000,
      minNights: 3,
      closedToArrival: true,
      closedToDeparture: false,
    },
  ],
  stays: [
    {
      id: crypto.randomUUID(),
      propertyId: lodge.id,
      checkIn: '2026-10-12',
      checkOut: '2026-10-16',
      status: 'confirmed',
      channel: 'airbnb',
      channelReference: 'HM8KQ2TZ4N',
      guestName: 'Priya Shah',
      guests: 4,
    },
    {
      id: crypto.randomUUID(),
      propertyId: lodge.id,
      checkIn: '2026-10-22',
      checkOut: '2026-10-24',
      status: 'conflict',
      channel: 'booking_com',
      channelReference: '4311850297',
      guestName: 'Ravi Kumar',
      guests: 2,
    },
  ],
  blocks: [
    {
      id: crypto.randomUUID(),
      propertyId: flat.id,
      startsOn: '2026-10-18',
      endsOn: '2026-10-20',
      reason: 'Owner staying',
    },
  ],
};

const rows = buildRows(calendar, nights);
const cell = (row: number, night: string) => rows[row]?.cells.find((c) => c.night === night);

describe('the calendar grid', () => {
  it('shows as many nights as fit, two weeks at least and two months at most', () => {
    expect(nightsThatFit(1100, 224)).toBe(16);
    expect(nightsThatFit(390, 136)).toBe(14);
    expect(nightsThatFit(5000, 224)).toBe(62);
  });

  it("works out each night from the property's usual rules and the night's own", () => {
    expect(cell(0, '2026-10-19')?.rules).toMatchObject({
      priceMinor: 16_500,
      priceFrom: 'usual',
      minNights: 2,
    });
    expect(cell(0, '2026-10-23')?.rules).toMatchObject({ priceMinor: 19_500, priceFrom: 'weekend' });
    expect(cell(0, '2026-10-20')).toMatchObject({
      own: true,
      rules: { priceMinor: 21_000, minNights: 3, minNightsFrom: 'night', closedToArrival: true },
    });
    expect(cell(1, '2026-10-23')?.rules.priceMinor).toBe(8_500);
  });

  it('knows which nights have passed, are booked or are blocked', () => {
    expect(cell(0, '2026-10-14')).toMatchObject({ past: true, booked: true });
    expect(cell(0, '2026-10-15')).toMatchObject({ past: false, booked: true });
    // Check-out morning: the night is free.
    expect(cell(0, '2026-10-16')?.booked).toBe(false);
    // A booking that came in over another holds no nights.
    expect(cell(0, '2026-10-22')?.booked).toBe(false);
    expect(cell(1, '2026-10-18')?.blocked).toBe(true);
    expect(cell(1, '2026-10-20')?.blocked).toBe(false);
  });

  it('draws a stay from the middle of its first night to the middle of its departure day', () => {
    expect(barFor('2026-10-22', '2026-10-24', nights)).toEqual({
      start: 9.5,
      length: 2,
      before: false,
      after: false,
    });
    // Began before the first night shown: drawn from the edge.
    expect(barFor('2026-10-12', '2026-10-16', nights)).toEqual({
      start: 0,
      length: 3.5,
      before: true,
      after: false,
    });
    expect(barFor('2026-10-25', '2026-10-30', nights)).toEqual({
      start: 12.5,
      length: 1.5,
      before: false,
      after: true,
    });
    expect(barFor('2026-10-01', '2026-10-05', nights)).toBeNull();
    // A departure and the next arrival meet in the middle of the turnover day.
    const leaving = barFor('2026-10-14', '2026-10-17', nights);
    const arriving = barFor('2026-10-17', '2026-10-19', nights);
    expect(leaving && leaving.start + leaving.length).toBe(arriving?.start);
  });

  it('turns a drag into the nights and properties between, from today on', () => {
    expect(selectionBetween(rows, nights, { row: 1, col: 9 }, { row: 0, col: 5 }, TODAY)).toEqual({
      propertyIds: [lodge.id, flat.id],
      firstNight: '2026-10-18',
      lastNight: '2026-10-22',
    });
    expect(selectionBetween(rows, nights, { row: 0, col: 0 }, { row: 0, col: 3 }, TODAY)).toMatchObject({
      firstNight: TODAY,
      lastNight: '2026-10-16',
    });
    expect(selectionBetween(rows, nights, { row: 0, col: 0 }, { row: 0, col: 1 }, TODAY)).toBeNull();
  });

  it('sums up what is there now', () => {
    const summary = summarise(
      { propertyIds: [lodge.id, flat.id], firstNight: '2026-10-15', lastNight: '2026-10-19' },
      rows,
    );
    expect(summary).toMatchObject({
      nights: 5,
      booked: 1,
      blocked: 2,
      prices: { low: 8_500, high: 19_500 },
      minNights: { low: 1, high: 2 },
    });
    expect(summary.pricedByPriceLabs.map((p) => p.name)).toEqual(['Mill Street Flat']);
    expect(summary.notSent.map((p) => p.name)).toEqual(['Mill Street Flat']);
  });
});

describe('a change to some nights', () => {
  const selection = { propertyIds: [lodge.id], firstNight: '2026-10-19', lastNight: '2026-10-25' };
  const form = (patch: Partial<ChangeForm>): ChangeForm => ({ ...newForm(), ...patch });

  it('asks for exactly what was chosen', () => {
    expect(toChange(form({ price: 'set', priceText: '£180' }), selection, 'GBP')).toEqual({
      change: { ...selection, priceMinor: 18_000 },
      errors: {},
    });
    expect(
      toChange(
        form({ price: 'usual', minStay: 'set', minNights: 3, arrivals: 'closed', departures: 'allowed' }),
        selection,
        'GBP',
      ).change,
    ).toEqual({
      ...selection,
      priceMinor: null,
      minNights: 3,
      closedToArrival: true,
      closedToDeparture: false,
    });
    expect(
      toChange(
        form({ availability: 'block', blockReason: ' Owner staying ', days: [5, 6] }),
        selection,
        'GBP',
      ).change,
    ).toEqual({ ...selection, blocked: true, blockReason: 'Owner staying', daysOfWeek: [5, 6] });
    expect(toChange(form({ availability: 'open', minStay: 'usual' }), selection, 'GBP').change).toEqual({
      ...selection,
      minNights: null,
      blocked: false,
    });
  });

  it('says what is wrong before anything is sent', () => {
    expect(toChange(form({ price: 'set', priceText: '' }), selection, 'GBP').errors.price).toBe(
      'Enter the price for a night',
    );
    expect(toChange(form({ price: 'set', priceText: 'twelve' }), selection, 'GBP').errors.price).toBe(
      'Enter an amount such as 120 or 120.50',
    );
    expect(toChange(form({ minStay: 'usual', days: [] }), selection, 'GBP').errors.days).toBe(
      'Choose at least one day of the week',
    );
    const oneMonday = { ...selection, lastNight: '2026-10-19' };
    expect(toChange(form({ minStay: 'usual', days: [6] }), oneMonday, 'GBP').errors.days).toBe(
      'None of the selected nights falls on those days',
    );
    expect(toChange(form({}), selection, 'GBP')).toEqual({
      change: null,
      errors: { form: 'Choose something to change' },
    });
  });

  it('says what happened in a line', () => {
    const none = { changedNights: 0, blockedNights: 0, takenNights: 0, reopenedNights: 0 };
    expect(resultMessage({ ...none, changedNights: 3 })).toBe('Changed 3 nights.');
    expect(resultMessage({ ...none, changedNights: 1, blockedNights: 4, takenNights: 2 })).toBe(
      'Changed 1 night and blocked 4 nights. 2 nights were already booked or blocked, so they stay as they are.',
    );
    expect(resultMessage({ ...none, reopenedNights: 2 })).toBe('Opened 2 nights.');
    expect(resultMessage({ ...none, takenNights: 1 })).toBe(
      'Nothing blocked: 1 night was already booked or blocked, so it stays as it is.',
    );
    expect(resultMessage(none)).toBe('Those nights already had those settings.');
  });

  it('names nights and windows the way people read them', () => {
    expect(rangeLabel('2026-10-23', '2026-10-25')).toBe('Fri 23 Oct to Sun 25 Oct');
    expect(rangeLabel('2026-10-23', '2026-10-23')).toBe('Fri 23 Oct');
    expect(windowLabel('2026-10-13', '2026-11-02')).toBe('13 October to 2 November 2026');
    expect(windowLabel('2026-12-28', '2027-01-10')).toBe('28 December 2026 to 10 January 2027');
    expect(monthSpans(nightsFrom('2026-10-30', 4))).toEqual([
      { label: 'October 2026', start: 0, length: 2 },
      { label: 'November 2026', start: 2, length: 2 },
    ]);
  });
});
