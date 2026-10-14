import { useEffect, useState } from 'react';

/** Re-renders every `intervalMs` so relative times and countdowns stay current. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

const MINUTE = 60_000;

/** "V-01" with a word joiner after the hyphen, so a line never breaks inside the name. */
export const V01 = 'V-\u206001';
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "4 min ago", "3 hours ago", "yesterday", "12 Oct". */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 'unknown';
  const diff = now - then;
  // A timestamp a moment ahead (clocks a little apart, or a reply that took a while) is still "just now".
  if (diff < -2 * MINUTE) {
    const ahead = -diff;
    if (ahead < HOUR) return `in ${Math.round(ahead / MINUTE)} min`;
    return `at ${clockTime(iso)}`;
  }
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.round(diff / MINUTE)} min ago`;
  if (diff < DAY) {
    const hours = Math.round(diff / HOUR);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  if (diff < 2 * DAY) return 'yesterday';
  return shortDate(iso);
}

/** "17:45", in the viewer's own time zone. */
export function clockTime(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/** "12 Oct", or "12 Oct 2025" outside the current year. */
export function shortDate(iso: string): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

/** "12 Oct, 17:45". */
export function dateTime(iso: string): string {
  return `${shortDate(iso)}, ${clockTime(iso)}`;
}

/** "1 property", "3 properties". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${new Intl.NumberFormat('en-GB').format(count)} ${count === 1 ? one : many}`;
}

export function number(count: number): string {
  return new Intl.NumberFormat('en-GB').format(count);
}

/** "30 min", "1 hour", "2 hours 15 min". */
export function duration(fromIso: string, toIso: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / MINUTE));
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}${rest ? ` ${rest} min` : ''}`;
}
