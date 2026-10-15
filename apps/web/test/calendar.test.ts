import type { Calendar, CalendarProperty } from '@v01/shared';
import { describe, expect, it } from 'vitest';
import {
  barFor,
  barLabel,
  buildRows,
  type CalendarFilters,
  type ChangeForm,
  chosenLabel,
  filterChoices,
  filterProperties,
  filtersOn,
  filtersToKeep,
  freeDatesError,
  freeLabel,
  monthSpans,
  NO_FILTERS,
  newForm,
  nightsFrom,
  nightsThatFit,
  parseFilters,
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
  area: 'Harbourside',
  city: 'Port Seton',
  bedrooms: 3,
  maxGuests: 6,
  tags: ['Sea view', 'Owner: Ellis'],
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
  area: 'Old Town',
  city: 'Edinburgh',
  bedrooms: 1,
  maxGuests: 2,
  tags: ['City centre'],
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
  propertyCount: 2,
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
  it('shows as many nights as fit, up to two months, and two weeks to scroll on a phone', () => {
    // Each night's box is 72 pixels wide at least.
    expect(nightsThatFit(1600, 224)).toBe(19);
    expect(nightsThatFit(1100, 224)).toBe(12);
    expect(nightsThatFit(730, 224)).toBe(7);
    expect(nightsThatFit(700, 224)).toBe(14);
    expect(nightsThatFit(390, 136)).toBe(14);
    expect(nightsThatFit(6000, 224)).toBe(62);
  });

  it('puts as much of a name on a bar as fits, and never a stray letter', () => {
    // A two-night stay: the whole name.
    expect(barLabel('Sofia Romano', 'Sofia', 112, 13)).toBe('Sofia Romano');
    // Shorter: the first name, rather than "Daniel Oka…".
    expect(barLabel('Daniel Okafor', 'Daniel', 60, 13)).toBe('Daniel');
    // A long first name in a short bar is cut short, but only with room for a few letters.
    expect(barLabel('Christopher Lee', 'Christopher', 50, 13)).toBe('Christopher');
    // A one-night stay: the mark alone.
    expect(barLabel('Jamie Clarke', 'Jamie', 23, 13)).toBeNull();
    expect(barLabel('Owner staying', null, 23, 13)).toBeNull();
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

describe('finding properties', () => {
  const filters = (patch: Partial<CalendarFilters>): CalendarFilters => ({ ...NO_FILTERS, ...patch });
  const names = (f: CalendarFilters) => filterProperties(rows, f).map((r) => r.property.name);

  it('offers the areas, towns, tags and sync states the properties have, with how many have each', () => {
    const cottage = property({ area: 'Harbourside', city: 'Harbourside', tags: ['Sea view', 'Sea view'] });
    expect(filterChoices([lodge, flat, cottage])).toEqual({
      areas: [
        { value: 'Edinburgh', count: 1 },
        { value: 'Harbourside', count: 2 },
        { value: 'Old Town', count: 1 },
        { value: 'Port Seton', count: 1 },
      ],
      tags: [
        { value: 'City centre', count: 1 },
        { value: 'Owner: Ellis', count: 1 },
        { value: 'Sea view', count: 2 },
      ],
      statuses: [
        { value: 'guesty', count: 1 },
        { value: 'v01', count: 2 },
      ],
    });
  });

  it('names what is chosen on each button', () => {
    expect(chosenLabel(['Riverside'], 'areas')).toBe('Riverside');
    expect(chosenLabel(['Riverside', 'Old Town'], 'areas')).toBe('2 areas');
    expect(freeLabel({ from: '2026-10-23', to: '2026-10-25', guests: 4 })).toBe(
      'Free 23 to 25 Oct, 4 guests',
    );
    expect(freeLabel({ from: '2026-10-30', to: '2026-11-02', guests: 1 })).toBe(
      'Free 30 Oct to 2 Nov, 1 guest',
    );
  });

  it('checks free dates before asking', () => {
    expect(freeDatesError('2026-10-23', '2026-10-25', TODAY)).toBeNull();
    expect(freeDatesError('', '2026-10-25', TODAY)).toBe('Choose the arrival date');
    expect(freeDatesError('2026-10-23', '', TODAY)).toBe('Choose the departure date');
    expect(freeDatesError('2026-10-14', '2026-10-16', TODAY)).toMatch(/has passed/);
    expect(freeDatesError('2026-10-23', '2026-10-23', TODAY)).toMatch(/after the arrival/);
  });

  it('keeps the view between visits, but not a search or free dates', () => {
    const chosen = filters({
      search: 'harbour',
      areas: ['Riverside'],
      tags: ['Family'],
      statuses: ['v01'],
      minBedrooms: 2,
      free: { from: '2026-10-23', to: '2026-10-25', guests: 4 },
    });
    const kept = JSON.parse(JSON.stringify(filtersToKeep(chosen)));
    expect(parseFilters(kept)).toEqual({ ...chosen, search: '', free: null });
    // Whatever was stored, it comes back as filters or as none.
    expect(parseFilters(null)).toEqual(NO_FILTERS);
    expect(parseFilters('areas')).toEqual(NO_FILTERS);
    expect(
      parseFilters({ areas: ['Riverside', 4, ''], statuses: ['v01', 'airbnb'], minBedrooms: 2.5, tags: 'x' }),
    ).toEqual({ ...NO_FILTERS, areas: ['Riverside'], statuses: ['v01'] });
  });

  it('narrows the rows by search, area, tag, status and bedrooms', () => {
    expect(names(NO_FILTERS)).toEqual(['Harbour View Lodge', 'Mill Street Flat']);
    expect(names(filters({ search: 'msf' }))).toEqual(['Mill Street Flat']);
    expect(names(filters({ search: 'harbour ellis' }))).toEqual(['Harbour View Lodge']);
    expect(names(filters({ areas: ['Edinburgh'] }))).toEqual(['Mill Street Flat']);
    expect(names(filters({ tags: ['sea view', 'City centre'] }))).toEqual([
      'Harbour View Lodge',
      'Mill Street Flat',
    ]);
    expect(names(filters({ statuses: ['guesty'] }))).toEqual(['Mill Street Flat']);
    expect(names(filters({ minBedrooms: 2 }))).toEqual(['Harbour View Lodge']);
    expect(names(filters({ areas: ['Edinburgh'], minBedrooms: 2 }))).toEqual([]);
  });

  it('counts the filters that are on', () => {
    expect(filtersOn(NO_FILTERS)).toBe(0);
    expect(
      filtersOn(
        filters({ search: ' ', tags: ['Family'], free: { from: TODAY, to: '2026-10-18', guests: 2 } }),
      ),
    ).toBe(2);
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
    expect(windowLabel('2026-10-13', '2026-10-27')).toBe('13 to 27 October 2026');
    expect(windowLabel('2026-10-13', '2026-11-02')).toBe('13 October to 2 November 2026');
    expect(windowLabel('2026-12-28', '2027-01-10')).toBe('28 December 2026 to 10 January 2027');
    expect(monthSpans(nightsFrom('2026-10-30', 4))).toEqual([
      { label: 'October 2026', start: 0, length: 2 },
      { label: 'November 2026', start: 2, length: 2 },
    ]);
  });
});
