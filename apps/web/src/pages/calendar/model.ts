import {
  addDays,
  CALENDAR_MAX_WINDOW,
  type Calendar,
  type CalendarBlock,
  type CalendarChange,
  type CalendarChangeResult,
  type CalendarNight,
  type CalendarProperty,
  type CalendarStay,
  formatMoney,
  type NightRules,
  nightRules,
  nightsBetween,
  selectedNights,
} from '@v01/shared';
import { plural } from '../../lib/format.ts';
import { priceToMinor } from '../properties/draft.ts';

/**
 * The calendar screen's model: what each night of each property shows, where bookings and blocks
 * are drawn, what is selected, and the change a person asks for. Kept apart from the screen so it
 * can be tested on its own.
 */

/** Sizes in pixels. A night's cell and a property's row are fixed, so long lists can be windowed. */
export const CELL_WIDTH = 52;
export const ROW_HEIGHT = 68;
export const NAME_WIDTH = 224;
export const NAME_WIDTH_NARROW = 136;
/** A narrow screen still gets two weeks, scrolled sideways. */
export const MIN_NIGHTS_SHOWN = 14;

/** As many nights as fit beside the property names, two weeks at least and two months at most. */
export function nightsThatFit(width: number, nameWidth: number): number {
  const fit = Math.floor((width - nameWidth) / CELL_WIDTH);
  return Math.max(MIN_NIGHTS_SHOWN, Math.min(CALENDAR_MAX_WINDOW, fit));
}

export function nightsFrom(first: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(first, i));
}

export interface NightCell {
  night: string;
  rules: NightRules;
  /** The night has a price or rule of its own. */
  own: boolean;
  /** Before today, where the operator is: shown, never changed. */
  past: boolean;
  /** Held by a confirmed booking. */
  booked: boolean;
  /** Held by a block. */
  blocked: boolean;
}

export interface CalendarRow {
  property: CalendarProperty;
  cells: NightCell[];
  stays: CalendarStay[];
  blocks: CalendarBlock[];
}

const holds = (night: string, start: string, end: string) => start <= night && night < end;

export function buildRows(calendar: Calendar, nights: string[]): CalendarRow[] {
  const own = new Map<string, CalendarNight>();
  for (const n of calendar.nights) own.set(`${n.propertyId}|${n.night}`, n);
  return calendar.properties.map((property) => {
    const stays = calendar.stays.filter((s) => s.propertyId === property.id);
    const blocks = calendar.blocks.filter((b) => b.propertyId === property.id);
    const cells = nights.map((night) => {
      const mine = own.get(`${property.id}|${night}`) ?? null;
      return {
        night,
        rules: nightRules(property, night, mine),
        own: mine !== null,
        past: night < calendar.today,
        booked: stays.some((s) => s.status === 'confirmed' && holds(night, s.checkIn, s.checkOut)),
        blocked: blocks.some((b) => holds(night, b.startsOn, b.endsOn)),
      };
    });
    return { property, cells, stays, blocks };
  });
}

export interface Bar {
  /** From the left edge of the first night shown, in cells. */
  start: number;
  /** In cells. */
  length: number;
  /** It began before the first night shown, or goes on after the last. */
  before: boolean;
  after: boolean;
}

/**
 * Where a stay or block is drawn: from the middle of its first night to the middle of the day it
 * ends, as on a booking calendar, so a departure and the next arrival share the turnover day.
 */
export function barFor(start: string, end: string, nights: string[]): Bar | null {
  const first = nights[0];
  if (!first) return null;
  const from = nightsBetween(first, start) + 0.5;
  const to = nightsBetween(first, end) + 0.5;
  const left = Math.max(0, from);
  const right = Math.min(nights.length, to);
  if (right <= left) return null;
  return { start: left, length: right - left, before: from < 0, after: to > nights.length };
}

export interface GridPoint {
  row: number;
  col: number;
}

export interface Selection {
  /** In the order of the rows. */
  propertyIds: string[];
  firstNight: string;
  lastNight: string;
}

/** The nights and properties between two cells, from today on: nights that have passed can't change. */
export function selectionBetween(
  rows: CalendarRow[],
  nights: string[],
  a: GridPoint,
  b: GridPoint,
  today: string,
): Selection | null {
  const top = Math.max(0, Math.min(a.row, b.row));
  const bottom = Math.min(rows.length - 1, Math.max(a.row, b.row));
  const first = nights[Math.max(0, Math.min(a.col, b.col))];
  const last = nights[Math.min(nights.length - 1, Math.max(a.col, b.col))];
  if (!first || !last || bottom < top || last < today) return null;
  return {
    propertyIds: rows.slice(top, bottom + 1).map((r) => r.property.id),
    firstNight: first < today ? today : first,
    lastNight: last,
  };
}

export function isSelected(selection: Selection | null, propertyId: string, night: string): boolean {
  return Boolean(
    selection &&
      night >= selection.firstNight &&
      night <= selection.lastNight &&
      selection.propertyIds.includes(propertyId),
  );
}

export interface SelectionSummary {
  properties: CalendarProperty[];
  /** Nights in the selection, per property. */
  nights: number;
  /** Property-nights already booked, and blocked, among those on screen. */
  booked: number;
  blocked: number;
  /** The prices the channels get for the selected nights now, lowest and highest. */
  prices: { low: number; high: number } | null;
  minNights: { low: number; high: number } | null;
  /** Properties whose prices PriceLabs sets. */
  pricedByPriceLabs: CalendarProperty[];
  /** Properties whose channels V-01 doesn't run yet, so nothing is sent for them. */
  notSent: CalendarProperty[];
}

export function summarise(selection: Selection, rows: CalendarRow[]): SelectionSummary {
  const chosen = rows.filter((r) => selection.propertyIds.includes(r.property.id));
  const cells = chosen.flatMap((r) =>
    r.cells.filter((c) => c.night >= selection.firstNight && c.night <= selection.lastNight),
  );
  const prices = cells.map((c) => c.rules.priceMinor).filter((p): p is number => p !== null);
  const stays = cells.map((c) => c.rules.minNights);
  return {
    properties: chosen.map((r) => r.property),
    nights: nightsBetween(selection.firstNight, selection.lastNight) + 1,
    booked: cells.filter((c) => c.booked).length,
    blocked: cells.filter((c) => c.blocked).length,
    prices: prices.length ? { low: Math.min(...prices), high: Math.max(...prices) } : null,
    minNights: stays.length ? { low: Math.min(...stays), high: Math.max(...stays) } : null,
    pricedByPriceLabs: chosen.map((r) => r.property).filter((p) => p.priceOwner !== 'v01'),
    notSent: chosen.map((r) => r.property).filter((p) => p.managedBy !== 'v01'),
  };
}

// The change a person asks for -------------------------------------------------------------------

export type RuleChoice = 'keep' | 'set' | 'usual';
export type DateChoice = 'keep' | 'allowed' | 'closed';
export type AvailabilityChoice = 'keep' | 'block' | 'open';

export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export interface ChangeForm {
  price: RuleChoice;
  priceText: string;
  minStay: RuleChoice;
  minNights: number;
  arrivals: DateChoice;
  departures: DateChoice;
  availability: AvailabilityChoice;
  blockReason: string;
  /** Days of the week, Monday 1 to Sunday 7. All seven: every night. */
  days: number[];
}

export function newForm(summary?: SelectionSummary): ChangeForm {
  return {
    price: 'keep',
    priceText: '',
    minStay: 'keep',
    minNights: summary?.minNights?.low ?? 2,
    arrivals: 'keep',
    departures: 'keep',
    availability: 'keep',
    blockReason: '',
    days: [...ALL_DAYS],
  };
}

export function hasChanges(form: ChangeForm): boolean {
  return (
    form.price !== 'keep' ||
    form.minStay !== 'keep' ||
    form.arrivals !== 'keep' ||
    form.departures !== 'keep' ||
    form.availability !== 'keep'
  );
}

export interface FormErrors {
  price?: string;
  days?: string;
  form?: string;
}

/** The form as the API takes it, or what is wrong with it. */
export function toChange(
  form: ChangeForm,
  selection: Selection,
  currency: string,
): { change: CalendarChange | null; errors: FormErrors } {
  const errors: FormErrors = {};
  const change: CalendarChange = {
    propertyIds: selection.propertyIds,
    firstNight: selection.firstNight,
    lastNight: selection.lastNight,
  };
  if (form.price === 'set') {
    const typed = priceToMinor(form.priceText, currency);
    if (typed.error) errors.price = typed.error;
    else if (typed.minor === undefined) errors.price = 'Enter the price for a night';
    else change.priceMinor = typed.minor;
  } else if (form.price === 'usual') {
    change.priceMinor = null;
  }
  if (form.minStay === 'set') change.minNights = form.minNights;
  else if (form.minStay === 'usual') change.minNights = null;
  if (form.arrivals !== 'keep') change.closedToArrival = form.arrivals === 'closed';
  if (form.departures !== 'keep') change.closedToDeparture = form.departures === 'closed';
  if (form.availability !== 'keep') {
    change.blocked = form.availability === 'block';
    const reason = form.blockReason.trim();
    if (form.availability === 'block' && reason) change.blockReason = reason;
  }
  if (form.days.length === 0) {
    errors.days = 'Choose at least one day of the week';
  } else if (form.days.length < ALL_DAYS.length) {
    change.daysOfWeek = [...form.days].sort((a, b) => a - b);
    if (selectedNights(selection.firstNight, selection.lastNight, change.daysOfWeek).length === 0) {
      errors.days = 'None of the selected nights falls on those days';
    }
  }
  if (!hasChanges(form)) errors.form = 'Choose something to change';
  return { change: Object.keys(errors).length ? null : change, errors };
}

function sentence(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** What happened, in a line: "Changed 3 nights and blocked 2. 1 night was already booked, so it stays as it is." */
export function resultMessage(result: CalendarChangeResult): string {
  const parts: string[] = [];
  if (result.changedNights) parts.push(`changed ${plural(result.changedNights, 'night')}`);
  if (result.blockedNights) parts.push(`blocked ${plural(result.blockedNights, 'night')}`);
  if (result.reopenedNights) parts.push(`opened ${plural(result.reopenedNights, 'night')}`);
  const taken = result.takenNights
    ? result.takenNights === 1
      ? '1 night was already booked or blocked, so it stays as it is.'
      : `${result.takenNights} nights were already booked or blocked, so they stay as they are.`
    : '';
  if (parts.length === 0) {
    return taken
      ? `Nothing blocked: ${taken.charAt(0).toLowerCase()}${taken.slice(1)}`
      : 'Those nights already had those settings.';
  }
  const done = sentence(parts);
  return [`${done.charAt(0).toUpperCase()}${done.slice(1)}.`, taken].filter(Boolean).join(' ');
}

// Words and money ------------------------------------------------------------------------------

const SHORT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const LONG = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });

const utc = (night: string) => new Date(`${night}T00:00:00Z`);

/** "Fri 23 Oct". */
export const shortNight = (night: string) => SHORT.format(utc(night)).replace(',', '');
/** "Friday 23 October 2026", for screen readers. */
export const longNight = (night: string) => LONG.format(utc(night)).replace(',', '');
/** "Mon". */
export const weekdayOf = (night: string) => WEEKDAY.format(utc(night));
export const dayOfMonth = (night: string) => Number(night.slice(8, 10));

const DAY_MONTH = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/** The nights on screen: "13 October to 10 November 2026". */
export function windowLabel(first: string, last: string): string {
  const start = first.slice(0, 4) === last.slice(0, 4) ? DAY_MONTH : DAY_MONTH_YEAR;
  return `${start.format(utc(first))} to ${DAY_MONTH_YEAR.format(utc(last))}`;
}

/** "Fri 23 Oct to Sun 25 Oct", or one night. */
export function rangeLabel(first: string, last: string): string {
  return first === last ? shortNight(first) : `${shortNight(first)} to ${shortNight(last)}`;
}

/** The months across the nights shown, with where each starts: "October 2026" over its days. */
export function monthSpans(nights: string[]): { label: string; start: number; length: number }[] {
  const spans: { label: string; start: number; length: number }[] = [];
  nights.forEach((night, index) => {
    const label = MONTH.format(utc(night));
    const current = spans.at(-1);
    if (current?.label === label) current.length += 1;
    else spans.push({ label, start: index, length: 1 });
  });
  return spans;
}

/** "£165", or "£165.50": whole amounts drop the pennies, as everywhere else. */
export function money(minor: number, currency: string, locale: string): string {
  return formatMoney({ amountMinor: minor, currency }, locale).replace(/\.00$/, '');
}

/** "£165 to £195", or one price. */
export function priceRange(range: { low: number; high: number }, currency: string, locale: string): string {
  return range.low === range.high
    ? money(range.low, currency, locale)
    : `${money(range.low, currency, locale)} to ${money(range.high, currency, locale)}`;
}

/** "Harbour View Lodge", "Harbour View Lodge and Mill Street Flat", "…, … and 3 more". */
export function propertyNames(properties: { name: string }[]): string {
  const names = properties.map((p) => p.name);
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
}
