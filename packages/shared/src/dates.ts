/**
 * Calendar dates are plain "YYYY-MM-DD" strings, local to the property.
 * A stay from check-in to check-out covers the nights [checkIn, checkOut):
 * a guest leaving on the 14th and another arriving on the 14th do not overlap.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.toISOString().slice(0, 10) === value;
}

function toUtcMs(value: string): number {
  if (!isIsoDate(value)) throw new Error(`Not a valid date: "${value}"`);
  return Date.parse(`${value}T00:00:00Z`);
}

export function addDays(value: string, days: number): string {
  return new Date(toUtcMs(value) + days * DAY_MS).toISOString().slice(0, 10);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((toUtcMs(checkOut) - toUtcMs(checkIn)) / DAY_MS);
}

/** Every night of a stay, as dates. */
export function eachNight(checkIn: string, checkOut: string): string[] {
  const nights = nightsBetween(checkIn, checkOut);
  if (nights <= 0) return [];
  return Array.from({ length: nights }, (_, i) => addDays(checkIn, i));
}

/** Today's date in a time zone, e.g. todayIn('Europe/London'). */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** True when two stays share at least one night. */
export function staysOverlap(
  a: { checkIn: string; checkOut: string },
  b: { checkIn: string; checkOut: string },
): boolean {
  return a.checkIn < b.checkOut && b.checkIn < a.checkOut;
}
