import type { Calendar, CalendarProperty } from '@v01/shared';
import { describe, expect, it } from 'vitest';
import {
  barFor,
  barLabel,
  buildRows,
  type CalendarFilters,
  type ChangeForm,
  cellFor,
  chosenLabel,
  cleaningWhen,
  filterChoices,
  filterProperties,
  filtersOn,
  filtersToKeep,
  freeDatesError,
  freeLabel,
  guestWhoLeft,
  mergeCalendars,
  monthSpans,
  NO_FILTERS,
  newForm,
  nightsFrom,
  nightsToChange,
  PIECE_NIGHTS,
  parseFilters,
  piecesFor,
  rangeLabel,
  resultMessage,
  selectionBetween,
  summarise,
  timelineFor,
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
  cleaning: { status: 'clean', changedAt: null, changedBy: null },
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

const rows = buildRows(calendar);
const cell = (row: number, night: string) => {
  const r = rows[row];
  return r ? cellFor(r, night, TODAY) : undefined;
};

describe('the timeline', () => {
  const timeline = timelineFor(TODAY);

  it('reaches a year back and two years ahead', () => {
    expect(timeline.first).toBe('2025-10-15');
    expect(timeline.last).toBe('2028-10-14');
    expect(timeline.nights).toHaveLength(365 + 730 + 1);
  });

  it('fetches the same four-week pieces for the same nights, wherever the scroll stopped', () => {
    const pieces = piecesFor(timeline, '2026-10-13', '2026-10-26');
    expect(pieces.length).toBeGreaterThanOrEqual(1);
    for (const piece of pieces) expect(piece.from <= piece.to).toBe(true);
    // Every night asked for is in a piece; pieces start on the timeline's four-week beat.
    for (const night of nightsFrom('2026-10-13', 14)) {
      expect(pieces.some((p) => p.from <= night && night <= p.to)).toBe(true);
    }
    expect(piecesFor(timeline, '2026-10-14', '2026-10-20')[0]).toEqual(
      pieces.find((p) => p.from <= '2026-10-14' && '2026-10-14' <= p.to),
    );
    expect(new Set(pieces.map((p) => p.from)).size).toBe(pieces.length);
    expect(
      pieces.every(
        (p) => (Date.parse(p.from) - Date.parse(timeline.first)) % (PIECE_NIGHTS * 86_400_000) === 0,
      ),
    ).toBe(true);
    // Never past the ends.
    expect(piecesFor(timeline, '2020-01-01', '2025-10-20')[0]?.from).toBe(timeline.first);
    expect(piecesFor(timeline, '2028-10-01', '2030-01-01').at(-1)?.to).toBe(timeline.last);
  });

  it('puts the pieces together with each stay, block and night once', () => {
    const later: Calendar = { ...calendar, from: '2026-10-27', to: '2026-11-23', nights: [], blocks: [] };
    const merged = mergeCalendars([calendar, later]);
    expect(merged).toMatchObject({ from: '2026-10-13', to: '2026-11-23' });
    expect(merged?.stays).toHaveLength(calendar.stays.length);
    expect(merged?.nights).toHaveLength(calendar.nights.length);
    expect(mergeCalendars([])).toBeNull();
  });
});

describe('the calendar grid', () => {
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
      TODAY,
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
      cleaning: [
        { value: 'dirty', count: 0 },
        { value: 'clean', count: 3 },
      ],
    });
  });

  it('names what is chosen on each button', () => {
    expect(chosenLabel(['Riverside'], 'areas')).toBe('Riverside');
    expect(chosenLabel(['Riverside', 'Old Town'], 'areas')).toBe('2 areas');
    expect(freeLabel({ from: '2026-10-23', to: '2026-10-25', guests: 4 })).toBe(
      'Available 23 to 25 Oct, 4 guests',
    );
    expect(freeLabel({ from: '2026-10-30', to: '2026-11-02', guests: 1 })).toBe(
      'Available 30 Oct to 2 Nov, 1 guest',
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

describe('clean and dirty', () => {
  it('filters by cleaning', () => {
    const [lodgeRow, flatRow] = rows;
    if (!lodgeRow || !flatRow) throw new Error('rows missing');
    const dirtyFlat = {
      ...flatRow,
      property: {
        ...flatRow.property,
        cleaning: { status: 'dirty' as const, changedAt: null, changedBy: null },
      },
    };
    const only = (cleaning: CalendarFilters['cleaning']) =>
      filterProperties([lodgeRow, dirtyFlat], { ...NO_FILTERS, cleaning }).map((r) => r.property.name);
    expect(only(['dirty'])).toEqual(['Mill Street Flat']);
    expect(only(['clean', 'dirty'])).toEqual(['Harbour View Lodge', 'Mill Street Flat']);
    expect(filtersOn({ ...NO_FILTERS, cleaning: ['dirty'] })).toBe(1);
  });

  it('says when it changed, where the operator is', () => {
    expect(cleaningWhen('2026-10-15T09:00:00Z', 'Europe/London', TODAY)).toBe('10:00 today');
    expect(cleaningWhen('2026-10-14T15:20:00Z', 'Europe/London', TODAY)).toBe('16:20 yesterday');
    expect(cleaningWhen('2026-10-12T15:20:00Z', 'Europe/London', TODAY)).toBe('Mon 12 Oct, 16:20');
  });

  it('names the guest whose check-out made it dirty', () => {
    const [lodgeRow] = rows;
    if (!lodgeRow) throw new Error('rows missing');
    expect(guestWhoLeft(lodgeRow, '2026-10-16')).toBe('Priya Shah');
    expect(guestWhoLeft(lodgeRow, '2026-10-17')).toBeNull();
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

  it('counts the nights the button will change', () => {
    const both = [lodge.id, flat.id];
    // Priya Shah has the lodge on the 15th, so blocking the 15th to the 17th blocks two nights.
    const lodgeStay = { propertyIds: [lodge.id], firstNight: '2026-10-15', lastNight: '2026-10-17' };
    expect(nightsToChange(form({ availability: 'block' }), lodgeStay, rows, TODAY)).toBe(2);
    // The flat is blocked on the 18th and 19th: blocking skips them, opening touches only them.
    const flatWeek = { propertyIds: [flat.id], firstNight: '2026-10-17', lastNight: '2026-10-20' };
    expect(nightsToChange(form({ availability: 'block' }), flatWeek, rows, TODAY)).toBe(2);
    expect(nightsToChange(form({ availability: 'open' }), flatWeek, rows, TODAY)).toBe(2);
    // A price goes on every chosen night, booked or not, on the chosen days only.
    const week = { propertyIds: both, firstNight: '2026-10-19', lastNight: '2026-10-25' };
    expect(nightsToChange(form({ price: 'set' }), week, rows, TODAY)).toBe(14);
    expect(nightsToChange(form({ price: 'set', days: [5, 6] }), week, rows, TODAY)).toBe(4);
    expect(nightsToChange(form({ price: 'set', days: [] }), week, rows, TODAY)).toBe(0);
    // Nights before today are never changed.
    const fromBefore = { propertyIds: [lodge.id], firstNight: '2026-10-13', lastNight: '2026-10-16' };
    expect(nightsToChange(form({ price: 'set' }), fromBefore, rows, TODAY)).toBe(2);
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
