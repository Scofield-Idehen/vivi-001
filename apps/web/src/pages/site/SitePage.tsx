import {
  IconCalendarMonth,
  IconChevronLeft,
  IconChevronRight,
  IconPaw,
  IconUsers,
} from '@tabler/icons-react';
import { addDays, type SiteHomeCard } from '@v01/shared';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Popover } from '../../components/Popover.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import { useSite } from '../../lib/api.ts';
import { cx, facts, money, plural, SiteFrame, Stepper, shortDay } from './parts.tsx';

const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const FIELD =
  'flex h-12 w-full items-center gap-2 rounded-xl border border-hairline bg-white px-3 text-left text-[15px] text-ink hover:border-slate';

/**
 * The booking website's front: every home on it, searchable by dates and guests (2 Nov 2026), in
 * place of Guesty's booking engine. With dates, each home says its total or why it isn't free.
 * The search lives in the address, so a link to a search opens the same results.
 */

const num = (v: string | null, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
};

export function partyFrom(params: URLSearchParams) {
  return {
    adults: Math.max(1, num(params.get('adults'), 1)),
    children: num(params.get('children'), 0),
    infants: num(params.get('infants'), 0),
    pets: num(params.get('pets'), 0),
  };
}

function GuestsPicker({
  party,
  onChange,
}: {
  party: ReturnType<typeof partyFrom>;
  onChange(p: ReturnType<typeof partyFrom>): void;
}) {
  const guests = party.adults + party.children;
  return (
    <Popover
      title="Guests"
      buttonClassName={FIELD}
      label={
        <>
          <IconUsers size={18} stroke={1.75} className="text-slate" />
          {plural(guests, 'guest')}
          {party.infants ? `, ${plural(party.infants, 'infant')}` : ''}
          {party.pets ? `, ${plural(party.pets, 'pet')}` : ''}
        </>
      }
    >
      <div className="w-[300px] px-4 py-2">
        <Stepper
          label="Adults"
          hint="13 or older"
          value={party.adults}
          min={1}
          max={30}
          onChange={(adults) => onChange({ ...party, adults })}
        />
        <Stepper
          label="Children"
          hint="2 to 12"
          value={party.children}
          min={0}
          max={20}
          onChange={(children) => onChange({ ...party, children })}
        />
        <Stepper
          label="Infants"
          hint="Under 2"
          value={party.infants}
          min={0}
          max={10}
          onChange={(infants) => onChange({ ...party, infants })}
        />
        <Stepper
          label="Pets"
          value={party.pets}
          min={0}
          max={5}
          onChange={(pets) => onChange({ ...party, pets })}
        />
      </div>
    </Popover>
  );
}

function HomeCard({
  slug,
  h,
  currency,
  query,
}: {
  slug: string;
  h: SiteHomeCard;
  currency: string;
  query: string;
}) {
  const unavailable = Boolean(h.stay && h.stay.totalMinor === null);
  return (
    <li>
      <Link
        to={`/book/${slug}/${h.id}${query}`}
        className={cx(
          'group block overflow-hidden rounded-2xl border border-hairline bg-white transition-shadow hover:shadow-[0_8px_24px_rgba(20,28,32,0.08)]',
          unavailable && 'opacity-70',
        )}
      >
        <div className="aspect-[4/3] overflow-hidden bg-linen">
          {h.coverUrl ? (
            <img
              src={h.coverUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          ) : null}
        </div>
        <div className="flex flex-col gap-1 p-4">
          <h2 className="font-semibold tracking-[-0.015em] text-[17px] leading-snug text-ink">{h.name}</h2>
          {h.place ? <p className="text-[13.5px] text-slate">{h.place}</p> : null}
          <p className="text-[13.5px] text-slate">{facts(h).join(', ')}</p>
          {h.petsAllowed ? (
            <p className="inline-flex items-center gap-1 text-[13px] text-slate">
              <IconPaw size={15} stroke={1.75} /> Pets welcome
            </p>
          ) : null}
          <div className="mt-2 text-[15px] text-ink">
            {h.stay ? (
              h.stay.totalMinor !== null ? (
                <p>
                  <span className="font-semibold">{money(h.stay.totalMinor, currency)}</span>
                  <span className="text-slate"> total</span>
                </p>
              ) : (
                <p className="text-[14px] text-slate">{h.stay.message}</p>
              )
            ) : h.fromMinor ? (
              <p>
                <span className="text-slate">From </span>
                <span className="font-semibold">{money(h.fromMinor, currency)}</span>
                <span className="text-slate"> a night</span>
              </p>
            ) : null}
          </div>
        </div>
      </Link>
    </li>
  );
}

function DatesPicker({
  checkIn,
  checkOut,
  onChange,
}: {
  checkIn: string | null;
  checkOut: string | null;
  onChange(stay: { checkIn: string | null; checkOut: string | null }): void;
}) {
  return (
    <Popover
      title="Dates"
      buttonClassName={FIELD}
      label={
        <>
          <IconCalendarMonth size={18} stroke={1.75} className="text-slate" />
          {checkIn ? (
            `${shortDay(checkIn)} to ${checkOut ? shortDay(checkOut) : '…'}`
          ) : (
            <span className="text-slate">Add dates</span>
          )}
        </>
      }
    >
      {(close) => (
        <div className="w-[300px] p-3">
          <PlainRange
            checkIn={checkIn}
            checkOut={checkOut}
            onChange={(stay) => {
              onChange(stay);
              if (stay.checkIn && stay.checkOut) close();
            }}
          />
        </div>
      )}
    </Popover>
  );
}

/** On the list the dates aren't for one home, so every day from today can be picked. */
function PlainRange({
  checkIn,
  checkOut,
  onChange,
}: {
  checkIn: string | null;
  checkOut: string | null;
  onChange(stay: { checkIn: string | null; checkOut: string | null }): void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [month, setMonth] = useState((checkIn ?? today).slice(0, 7));
  const shift = (by: number) => {
    const d = new Date(`${month}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + by);
    setMonth(d.toISOString().slice(0, 7));
  };
  const first = `${month}-01`;
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const days: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = first; d.slice(0, 7) === month; d = addDays(d, 1)) days.push(d);
  const picking = Boolean(checkIn && !checkOut);
  return (
    <div className="select-none">
      <div className="mb-1 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-linen disabled:opacity-30"
          onClick={() => shift(-1)}
          disabled={month <= today.slice(0, 7)}
        >
          <IconChevronLeft size={18} stroke={1.75} />
        </button>
        <span className="text-[14px] font-medium text-ink">
          {MONTH.format(new Date(`${first}T12:00:00`))}
        </span>
        <button
          type="button"
          aria-label="Next month"
          className="inline-flex size-8 items-center justify-center rounded-lg hover:bg-linen"
          onClick={() => shift(1)}
        >
          <IconChevronRight size={18} stroke={1.75} />
        </button>
      </div>
      <p className="mb-1 text-center text-[12.5px] text-slate">
        {picking ? 'Choose your check-out' : 'Choose your check-in'}
      </p>
      <div className="grid grid-cols-7 gap-y-1">
        {days.map((day, i) =>
          day ? (
            <button
              key={day}
              type="button"
              disabled={day < today}
              onClick={() =>
                picking && checkIn && day > checkIn
                  ? onChange({ checkIn, checkOut: day })
                  : onChange({ checkIn: day, checkOut: null })
              }
              className={cx(
                'h-9 rounded-lg text-[13.5px] tnum text-ink disabled:text-mist/50',
                day === checkIn || day === checkOut
                  ? 'bg-ink text-canvas'
                  : checkIn && checkOut && day > checkIn && day < checkOut
                    ? 'rounded-none bg-accent-tint'
                    : 'hover:bg-linen',
              )}
            >
              {Number(day.slice(8))}
            </button>
          ) : (
            // biome-ignore lint/suspicious/noArrayIndexKey: blanks have nothing else to be keyed by
            <span key={`b-${i}`} />
          ),
        )}
      </div>
    </div>
  );
}

export function SitePage() {
  const { slug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const checkIn = params.get('checkIn');
  const checkOut = params.get('checkOut');
  const party = partyFrom(params);
  const [bedrooms, setBedrooms] = useState(0);
  const [petsOnly, setPetsOnly] = useState(false);
  const search = {
    ...(checkIn && checkOut ? { checkIn, checkOut } : {}),
    ...party,
  };
  const preview = params.get('preview');
  const site = useSite(slug, search, preview);
  const set = (next: Record<string, string | number | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === '' || v === 0) p.delete(k);
      else p.set(k, String(v));
    }
    if (p.get('adults') === '1') p.delete('adults');
    setParams(p, { replace: true });
  };

  if (site.isPending)
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas">
        <Spinner />
      </div>
    );
  if (site.isError || !site.data)
    return (
      <div className="flex min-h-dvh items-center justify-center bg-canvas px-6 text-center">
        <p className="max-w-[40ch] text-[16px] text-slate">
          There’s no booking site at this address. Check the link you were sent.
        </p>
      </div>
    );
  const s = site.data;
  const query = params.toString() ? `?${params.toString()}` : '';
  const homes = s.homes
    .filter((h) => !bedrooms || (h.bedrooms ?? 0) >= bedrooms)
    .filter((h) => !petsOnly || h.petsAllowed)
    // With dates, free homes first.
    .sort((a, b) => Number(a.stay?.totalMinor === null) - Number(b.stay?.totalMinor === null));
  const free = homes.filter((h) => !h.stay || h.stay.totalMinor !== null).length;

  return (
    <SiteFrame slug={slug} brand={s.brand} testMode={s.testMode} preview={preview}>
      <section className="pt-8 pb-6">
        <h1 className="font-semibold tracking-[-0.025em] text-[30px] leading-tight text-ink sm:text-[36px]">
          Find your stay
        </h1>
        <div className="mt-5 grid gap-3 rounded-2xl border border-hairline bg-paper p-3 sm:grid-cols-[1.2fr_1fr] lg:max-w-[760px]">
          <DatesPicker
            checkIn={checkIn}
            checkOut={checkOut}
            onChange={(d) => set({ checkIn: d.checkIn, checkOut: d.checkOut })}
          />
          <GuestsPicker party={party} onChange={(p) => set(p)} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[14px]">
          <label className="inline-flex h-9 items-center gap-2 rounded-full border border-hairline bg-white px-3">
            <span className="text-slate">Bedrooms</span>
            <select
              value={bedrooms}
              onChange={(e) => setBedrooms(Number(e.target.value))}
              className="bg-transparent text-ink outline-none"
            >
              <option value={0}>Any</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}+
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-pressed={petsOnly}
            onClick={() => setPetsOnly((v) => !v)}
            className={cx(
              'inline-flex h-9 items-center gap-1.5 rounded-full border px-3',
              petsOnly ? 'border-ink bg-ink text-canvas' : 'border-hairline bg-white text-ink',
            )}
          >
            <IconPaw size={15} stroke={1.75} /> Pets welcome
          </button>
          {checkIn || bedrooms || petsOnly || party.adults > 1 || party.children ? (
            <button
              type="button"
              className="action !h-9"
              onClick={() => {
                setBedrooms(0);
                setPetsOnly(false);
                setParams(new URLSearchParams(preview ? { preview } : {}), { replace: true });
              }}
            >
              Clear search
            </button>
          ) : null}
        </div>
      </section>
      <p className="mb-3 text-[14px] text-slate" aria-live="polite">
        {checkIn && checkOut ? `${plural(free, 'home')} free for those dates` : plural(homes.length, 'home')}
        {site.isFetching ? ' · checking…' : ''}
      </p>
      {homes.length ? (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {homes.map((h) => (
            <HomeCard key={h.id} slug={slug} h={h} currency={s.currency} query={query} />
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl bg-paper px-5 py-8 text-center text-[15px] text-slate">
          No homes match. Try fewer filters.
        </p>
      )}
    </SiteFrame>
  );
}
