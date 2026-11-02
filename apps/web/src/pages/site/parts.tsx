import { IconChevronLeft, IconChevronRight, IconMail, IconPhone } from '@tabler/icons-react';
import { addDays, formatMoney } from '@v01/shared';
import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useSiteNights } from '../../lib/api.ts';

/**
 * The parts the booking website's pages share (2 Nov 2026): the operator's header and contact
 * footer, money, and the calendar guests pick their stay on.
 */

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export const money = (amountMinor: number, currency: string) =>
  formatMoney({ amountMinor, currency }).replace(/\.00$/, '');

const SHORT = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const LONG = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const noon = (day: string) => new Date(`${day}T12:00:00`);
export const shortDay = (day: string) => SHORT.format(noon(day));
export const longDay = (day: string) => LONG.format(noon(day));
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface Brand {
  name: string;
  logoUrl: string | null;
  accentHex: string | null;
  phone: string | null;
  email: string | null;
}

export function SiteFrame({
  slug,
  brand,
  testMode,
  children,
}: {
  slug: string;
  brand: Brand | undefined;
  testMode?: boolean;
  children: ReactNode;
}) {
  const accent = brand?.accentHex ?? '#1e4d4f';
  return (
    <div className="flex min-h-dvh flex-col bg-canvas" style={{ '--color-accent': accent } as CSSProperties}>
      {testMode ? (
        <p className="bg-ink px-4 py-1.5 text-center text-[12.5px] text-canvas">
          Test mode: payments use Stripe’s test cards and no real money moves.
        </p>
      ) : null}
      <header className="border-b border-hairline bg-white">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-4 sm:px-6">
          <Link
            to={`/book/${slug}`}
            className="flex items-center gap-2"
            aria-label={`${brand?.name ?? ''} homes`}
          >
            {brand?.logoUrl ? (
              <img src={brand.logoUrl} alt={brand.name} className="h-9 w-auto" />
            ) : (
              <span className="font-semibold tracking-[-0.015em] text-[19px] text-ink">
                {brand?.name ?? ''}
              </span>
            )}
          </Link>
          <Link to={`/book/${slug}`} className="text-[14.5px] text-ink hover:text-accent">
            All homes
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1180px] flex-1 px-4 pb-16 sm:px-6">{children}</main>
      {brand && (brand.phone || brand.email) ? (
        <footer className="border-t border-hairline bg-white">
          <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-[14px] text-slate sm:px-6">
            <span className="font-medium text-ink">{brand.name}</span>
            {brand.phone ? (
              <a
                href={`tel:${brand.phone.replace(/\s+/g, '')}`}
                className="inline-flex items-center gap-1.5 hover:text-ink"
              >
                <IconPhone size={16} stroke={1.75} />
                {brand.phone}
              </a>
            ) : null}
            {brand.email ? (
              <a href={`mailto:${brand.email}`} className="inline-flex items-center gap-1.5 hover:text-ink">
                <IconMail size={16} stroke={1.75} />
                {brand.email}
              </a>
            ) : null}
          </div>
        </footer>
      ) : null}
    </div>
  );
}

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const monthOf = (day: string) => day.slice(0, 7);
function shiftMonth(month: string, by: number): string {
  const d = new Date(`${month}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
}
function lastOf(month: string): string {
  return addDays(`${shiftMonth(month, 1)}-01`, -1);
}
function weeksOf(month: string): (string | null)[] {
  const first = `${month}-01`;
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const days: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = first; monthOf(d) === month; d = addDays(d, 1)) days.push(d);
  while (days.length % 7) days.push(null);
  return days;
}

/**
 * Pick a stay: the first tap is the arrival, the second the departure. Taken nights are crossed
 * out; while choosing the departure, days past the next taken night can't be picked (leaving on
 * the morning another stay starts is fine). Each free night shows its price.
 */
export function StayCalendar({
  slug,
  homeId,
  currency,
  checkIn,
  checkOut,
  onChange,
  months = 1,
}: {
  slug: string;
  homeId: string;
  currency: string;
  checkIn: string | null;
  checkOut: string | null;
  onChange(stay: { checkIn: string | null; checkOut: string | null }): void;
  months?: 1 | 2;
}) {
  const [month, setMonth] = useState(() => monthOf(checkIn ?? new Date().toISOString().slice(0, 10)));
  const shown = months === 2 ? [month, shiftMonth(month, 1)] : [month];
  // One read per month: a month is at most 31 nights, within the API's window.
  const first = useSiteNights(slug, homeId, `${shown[0]}-01`, lastOf(shown[0] as string));
  const second = useSiteNights(slug, homeId, `${shown.at(-1)}-01`, lastOf(shown.at(-1) as string));
  const today = first.data?.today ?? new Date().toISOString().slice(0, 10);
  const nights = new Map(
    [...(first.data?.nights ?? []), ...(second.data?.nights ?? [])].map((n) => [n.night, n]),
  );
  const picking = Boolean(checkIn && !checkOut);
  // While choosing the departure: the first taken night after the arrival is the last day to leave.
  let lastOut: string | null = null;
  if (picking && checkIn) {
    for (let d = checkIn; d <= addDays(checkIn, 92); d = addDays(d, 1)) {
      const n = nights.get(d);
      if (n && !n.free) {
        lastOut = d;
        break;
      }
    }
  }
  const pick = (day: string) => {
    if (picking && checkIn && day > checkIn && (!lastOut || day <= lastOut)) {
      onChange({ checkIn, checkOut: day });
      return;
    }
    onChange({ checkIn: day, checkOut: null });
  };
  const minNights = checkIn ? (nights.get(checkIn)?.minNights ?? 1) : 1;

  return (
    <div className="select-none">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          disabled={month <= monthOf(today)}
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
          className="inline-flex size-9 items-center justify-center rounded-lg text-ink hover:bg-linen disabled:opacity-30"
        >
          <IconChevronLeft size={18} stroke={1.75} />
        </button>
        <p className="text-[13px] text-slate" aria-live="polite">
          {picking
            ? `Now choose your check-out${minNights > 1 ? ` (at least ${minNights} nights)` : ''}`
            : 'Choose your check-in'}
        </p>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          className="inline-flex size-9 items-center justify-center rounded-lg text-ink hover:bg-linen"
        >
          <IconChevronRight size={18} stroke={1.75} />
        </button>
      </div>
      <div className={cx('grid gap-6', months === 2 && 'sm:grid-cols-2')}>
        {shown.map((m) => (
          <div key={m}>
            <p className="mb-1 text-center text-[14.5px] font-medium text-ink">
              {MONTH.format(noon(`${m}-01`))}
            </p>
            <div className="grid grid-cols-7 text-center text-[11.5px] text-mist">
              {WEEKDAYS.map((w) => (
                <span key={w} className="py-1">
                  {w}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-1">
              {weeksOf(m).map((day, i) => {
                // biome-ignore lint/suspicious/noArrayIndexKey: blanks have nothing else to be keyed by
                if (!day) return <span key={`b-${m}-${i}`} />;
                const n = nights.get(day);
                const past = day < today;
                const asOut = picking && checkIn !== null && day > checkIn;
                const canOut =
                  asOut &&
                  (!lastOut || day <= lastOut) &&
                  !n?.closedToDeparture &&
                  day >= addDays(checkIn as string, minNights);
                // An arrival needs its shortest stay free after it, as far as this view knows.
                const stayFits = (() => {
                  if (!n) return false;
                  for (let k = 1; k < n.minNights; k += 1) {
                    const next = nights.get(addDays(day, k));
                    if (next && !next.free) return false;
                  }
                  return true;
                })();
                const canIn =
                  !past && Boolean(n?.free) && !n?.closedToArrival && Boolean(n?.priceMinor) && stayFits;
                const enabled = picking ? canOut || canIn : canIn;
                const chosen = day === checkIn || day === checkOut;
                const between = checkIn && checkOut && day > checkIn && day < checkOut;
                return (
                  <button
                    key={day}
                    type="button"
                    disabled={!enabled}
                    onClick={() => pick(day)}
                    aria-pressed={chosen}
                    aria-label={`${longDay(day)}${n && !n.free ? ', taken' : ''}`}
                    className={cx(
                      'flex h-12 flex-col items-center justify-center rounded-lg text-[14px] tnum transition-colors',
                      chosen
                        ? 'bg-ink font-medium text-canvas'
                        : between
                          ? 'rounded-none bg-accent-tint text-ink'
                          : enabled
                            ? 'text-ink hover:bg-linen'
                            : 'cursor-not-allowed text-mist/60',
                      !past && n && !n.free && !chosen && 'line-through',
                    )}
                  >
                    <span>{Number(day.slice(8))}</span>
                    {!past && n?.free && n.priceMinor && !chosen ? (
                      <span className="text-[10px] leading-none text-slate">
                        {money(n.priceMinor, currency).replace(/^[^0-9]*/, '')}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {checkIn ? (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            className="action !h-8"
            onClick={() => onChange({ checkIn: null, checkOut: null })}
          >
            Clear dates
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** A number with − and + buttons, for guests. */
export function Stepper({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange(n: number): void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div>
        <p className="text-[15px] text-ink">{label}</p>
        {hint ? <p className="text-[12.5px] text-slate">{hint}</p> : null}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`Fewer ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
          className="inline-flex size-9 items-center justify-center rounded-full border border-hairline text-[18px] text-ink hover:bg-linen disabled:opacity-30"
        >
          −
        </button>
        <span className="w-5 text-center text-[15px] tnum text-ink" aria-live="polite">
          {value}
        </span>
        <button
          type="button"
          aria-label={`More ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
          className="inline-flex size-9 items-center justify-center rounded-full border border-hairline text-[18px] text-ink hover:bg-linen disabled:opacity-30"
        >
          +
        </button>
      </div>
    </div>
  );
}

/** Facts a guest scans: guests, bedrooms, beds, bathrooms. */
export function facts(h: {
  propertyType: string | null;
  maxGuests: number;
  bedrooms: number | null;
  beds: number | null;
  bathrooms: number | null;
}): string[] {
  return [
    h.propertyType,
    plural(h.maxGuests, 'guest'),
    h.bedrooms !== null ? (h.bedrooms === 0 ? 'Studio' : plural(h.bedrooms, 'bedroom')) : null,
    h.beds !== null ? plural(h.beds, 'bed') : null,
    h.bathrooms !== null ? `${h.bathrooms} ${h.bathrooms === 1 ? 'bathroom' : 'bathrooms'}` : null,
  ].filter((x): x is string => Boolean(x));
}
