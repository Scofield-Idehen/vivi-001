import { IconAlertTriangle, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { formatMoney, type OverviewRange, type Revenue, type Trends } from '@v01/shared';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Spinner } from '../../components/Spinner.tsx';
import { useOverview, useRevenue, useTrends } from '../../lib/api.ts';

/**
 * Today's overview, laid out after Guesty's dashboard (Alpha, 29 Oct 2026): the day's moves with
 * how many are done, revenue for a month against the month before, and the trend of the coming days.
 * One hue for "now" (the accent), a quiet grey for "before"; numbers stay in ink.
 */

const at = (day: string) => new Date(`${day}T12:00:00`);
const DAY_LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const DAY_SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const WEEKDAY = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** A small segmented switch: Today / Tomorrow / Next 7 days, 7 / 30 days. */
function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div title={label} className="inline-flex rounded-full bg-linen p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-8 rounded-full px-3.5 text-[13px] font-medium transition-colors ${value === o.value ? 'bg-canvas text-ink shadow-[0_1px_2px_rgb(21_24_27/0.12)]' : 'text-slate hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Panel({
  id,
  title,
  sub,
  end,
  children,
  className = '',
}: {
  id: string;
  title: string;
  sub?: ReactNode;
  end?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={`rounded-2xl border border-hairline bg-canvas p-5 ${className}`}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id={id} className="text-[17px] font-semibold tracking-[-0.015em] text-ink">
            {title}
          </h2>
          {sub ? <p className="mt-0.5 text-[13px] text-slate">{sub}</p> : null}
        </div>
        {end}
      </div>
      {children}
    </section>
  );
}

/** A done-of-total ring: the arc is how many are done. */
function Ring({ done, total }: { done: number; total: number }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const share = total ? Math.min(done / total, 1) : 0;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden className="shrink-0 -rotate-90">
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--color-linen)" strokeWidth="5" />
      {share > 0 ? (
        <circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${c * share} ${c}`}
        />
      ) : null}
    </svg>
  );
}

function Tile({
  to,
  label,
  value,
  ring,
  foot,
}: {
  to: string | null;
  label: string;
  value: ReactNode;
  ring?: { done: number; total: number };
  foot?: ReactNode;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] text-slate">{label}</p>
          <p className="mt-1 text-[28px] leading-none font-semibold tracking-[-0.02em] text-ink tnum">
            {value}
          </p>
        </div>
        {ring ? <Ring {...ring} /> : null}
      </div>
      {foot ? <div className="mt-auto pt-4 text-[12.5px]">{foot}</div> : null}
    </>
  );
  const box = 'flex min-h-[132px] flex-col rounded-xl border border-hairline bg-canvas p-4';
  return to ? (
    <Link to={to} className={`${box} transition-colors hover:border-edge hover:bg-paper`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

const RANGE_WORDS: Record<OverviewRange, string> = {
  today: 'today',
  tomorrow: 'tomorrow',
  week: 'this week',
};

export function DailyOverview({ orgId, canSeeProperties }: { orgId: string; canSeeProperties: boolean }) {
  const [range, setRange] = useState<OverviewRange>('today');
  const q = useOverview(orgId, range);
  const d = q.data;
  const isToday = range === 'today';
  const notReady = d && d.checkIns.ready !== null ? d.checkIns.total - d.checkIns.ready : 0;
  const hours = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${h % 1 ? h.toFixed(1) : h} hours`);
  return (
    <Panel
      id="daily-overview"
      title="Daily overview"
      sub={
        d
          ? d.from === d.to
            ? DAY_LONG.format(at(d.from))
            : `${DAY_SHORT.format(at(d.from))} – ${DAY_SHORT.format(at(d.to))}`
          : null
      }
      end={
        <Segmented
          label="Which days"
          value={range}
          onChange={setRange}
          options={[
            { value: 'today', label: 'Today' },
            { value: 'tomorrow', label: 'Tomorrow' },
            { value: 'week', label: 'Next 7 days' },
          ]}
        />
      }
    >
      {!d ? (
        <Spinner size={16} />
      ) : (
        <div
          className={`grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 ${q.isPlaceholderData ? 'opacity-60' : ''}`}
        >
          <Tile
            to={isToday ? '/today/arriving' : '/calendar'}
            label={isToday ? 'Checked in' : `Checking in ${RANGE_WORDS[range]}`}
            value={
              isToday ? (
                <>
                  {d.checkIns.done}
                  <span className="text-[18px] text-mist">/{d.checkIns.total}</span>
                </>
              ) : (
                d.checkIns.total
              )
            }
            ring={isToday ? { done: d.checkIns.done ?? 0, total: d.checkIns.total } : undefined}
            foot={
              isToday && canSeeProperties && notReady > 0 ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-pending-text">
                  <IconAlertTriangle size={15} stroke={1.75} aria-hidden />
                  {notReady} {notReady === 1 ? 'home' : 'homes'} not ready
                </span>
              ) : isToday ? (
                <span className="text-slate">
                  {d.checkIns.total === 0
                    ? 'No arrivals'
                    : d.checkIns.done === d.checkIns.total
                      ? 'Everyone is in'
                      : 'Counted once check-in time passes'}
                </span>
              ) : null
            }
          />
          <Tile
            to={isToday ? '/today/leaving' : '/calendar'}
            label={isToday ? 'Checked out' : `Checking out ${RANGE_WORDS[range]}`}
            value={
              isToday ? (
                <>
                  {d.checkOuts.done}
                  <span className="text-[18px] text-mist">/{d.checkOuts.total}</span>
                </>
              ) : (
                d.checkOuts.total
              )
            }
            ring={isToday ? { done: d.checkOuts.done ?? 0, total: d.checkOuts.total } : undefined}
            foot={
              isToday && canSeeProperties && d.checkOuts.total > 0 ? (
                <span className="text-slate">
                  {d.checkOuts.cleaned} of {d.checkOuts.total} {d.checkOuts.total === 1 ? 'home' : 'homes'}{' '}
                  cleaned again
                </span>
              ) : null
            }
          />
          <Tile
            to="/tasks"
            label="Turnovers"
            value={d.turnovers.total}
            foot={
              d.turnovers.shortestHours !== null ? (
                <span className="inline-flex rounded-full bg-linen px-2.5 py-1 font-medium text-ink">
                  Shortest turnover: {hours(d.turnovers.shortestHours)}
                </span>
              ) : (
                <span className="text-slate">Same-day leave and arrive</span>
              )
            }
          />
          <Tile
            to={canSeeProperties ? '/today/cleans' : null}
            label="Staying"
            value={d.staying}
            foot={
              canSeeProperties ? (
                d.needCleaning ? (
                  <span className="font-medium text-pending-text">
                    {d.needCleaning} {d.needCleaning === 1 ? 'unit needs' : 'units need'} cleaning
                  </span>
                ) : (
                  <span className="text-slate">Every unit is clean</span>
                )
              ) : null
            }
          />
        </div>
      )}
    </Panel>
  );
}

function money(minor: number, currency: string, locale: string) {
  return formatMoney({ amountMinor: minor, currency }, locale).replace(/\.\d\d$/, '');
}

function Change({ now, before }: { now: number | null; before: number | null }) {
  if (now === null || !before) return <span className="text-[12.5px] text-mist">Nothing to compare</span>;
  const pct = Math.round(((now - before) / before) * 1000) / 10;
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[12px] font-semibold tnum ${up ? 'bg-done/15 text-done-text' : 'bg-urgent/10 text-urgent'}`}
    >
      {up ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  );
}

function Legend({ month, before }: { month: string; before: string }) {
  const name = (m: string) => MONTH.format(new Date(`${m}-01T00:00:00Z`)).split(' ')[0];
  return (
    <div className="mt-3 flex gap-4 text-[12px] text-slate">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-[3px] w-4 rounded-full bg-accent" aria-hidden /> {name(month)}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-0 w-4 border-t-2 border-dashed border-mist" aria-hidden /> {name(before)}
      </span>
    </div>
  );
}

const H = 200;
const PAD = { l: 56, r: 8, t: 10, b: 24 };

/** The chart's own width in CSS pixels, so text stays its real size whatever the card's width. */
function useWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(560);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setW(Math.max(240, Math.round(e.contentRect.width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function ticks(max: number): number[] {
  if (max <= 0) return [0];
  const step = 10 ** Math.floor(Math.log10(max / 3));
  const nice = [1, 2, 2.5, 5, 10].map((k) => k * step).find((s) => max / s <= 4) ?? step * 10;
  const out = [];
  for (let v = 0; v <= max + nice * 0.01; v += nice) out.push(v);
  const last = out.at(-1) ?? 0;
  if (last < max) out.push(last + nice);
  return out;
}

function AdrChart({ r, locale }: { r: Revenue; locale: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, W] = useWidth();
  const days = r.adr.days;
  const max = Math.max(1, ...days.flatMap((d) => [d.currentMinor ?? 0, d.previousMinor ?? 0]));
  const ys = ticks(max);
  const top = ys.at(-1) ?? 1;
  const x = (i: number) => PAD.l + (i / Math.max(days.length - 1, 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  const path = (pick: (d: Revenue['adr']['days'][number]) => number | null) => {
    let s = '';
    let pen = false;
    days.forEach((d, i) => {
      const v = pick(d);
      if (v === null) {
        pen = false;
        return;
      }
      s += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return s;
  };
  const h = hover === null ? null : days[hover];
  const short = (v: number) => money(v, r.currency, locale);
  return (
    <div ref={box} className="relative w-full min-w-0 overflow-hidden">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block touch-none"
        role="img"
        aria-label="Average daily rate, day by day, against the month before"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - box.left) / box.width) * W;
          const i = Math.round(((px - PAD.l) / (W - PAD.l - PAD.r)) * (days.length - 1));
          setHover(Math.max(0, Math.min(days.length - 1, i)));
        }}
      >
        {ys.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--color-hairline)" />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" className="fill-mist text-[11px] tnum">
              {short(v)}
            </text>
          </g>
        ))}
        {days.map((d, i) =>
          i % 7 === 0 || (i === days.length - 1 && i % 7 >= 3) ? (
            <text key={d.date} x={x(i)} y={H - 4} textAnchor="middle" className="fill-mist text-[11px]">
              {Number(d.date.slice(8))}
            </text>
          ) : null,
        )}
        <path
          d={path((d) => d.previousMinor)}
          fill="none"
          stroke="var(--color-mist)"
          strokeWidth="2"
          strokeDasharray="4 4"
        />
        <path
          d={path((d) => d.currentMinor)}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {hover !== null ? (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-edge)" />
            {h?.currentMinor !== null && h ? (
              <circle
                cx={x(hover)}
                cy={y(h.currentMinor)}
                r="4.5"
                fill="var(--color-accent)"
                stroke="var(--color-canvas)"
                strokeWidth="2"
              />
            ) : null}
          </>
        ) : null}
      </svg>
      {h ? (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-lg border border-hairline bg-canvas px-3 py-2 text-[12.5px] shadow-[0_8px_24px_-12px_rgb(21_24_27/0.3)]"
          style={{
            left: `${(x(hover ?? 0) / W) * 100}%`,
            transform: `translateX(${(hover ?? 0) > days.length / 2 ? '-105%' : '5%'})`,
          }}
        >
          <p className="font-medium text-ink">{DAY_LONG.format(at(h.date))}</p>
          <p className="text-slate tnum">
            This month: {h.currentMinor === null ? '—' : short(h.currentMinor)}
          </p>
          <p className="text-slate tnum">
            Month before: {h.previousMinor === null ? '—' : short(h.previousMinor)}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function WeekBars({ r, locale }: { r: Revenue; locale: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, W] = useWidth();
  const weeks = r.total.weeks;
  const max = Math.max(1, ...weeks.flatMap((w) => [w.currentMinor, w.previousMinor]));
  const ys = ticks(max);
  const top = ys.at(-1) ?? 1;
  const y = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  const slot = (W - PAD.l - PAD.r) / weeks.length;
  const bar = Math.min(22, slot / 3);
  const short = (v: number) => money(v, r.currency, locale);
  const h = hover === null ? null : weeks[hover];
  const rect = (cx: number, v: number, fill: string) => {
    const top = y(v);
    const height = H - PAD.b - top;
    if (height <= 0) return null;
    const rr = Math.min(4, height);
    return (
      <path
        d={`M${cx},${H - PAD.b}V${top + rr}q0,-${rr} ${rr},-${rr}h${bar - 2 * rr}q${rr},0 ${rr},${rr}V${H - PAD.b}Z`}
        fill={fill}
      />
    );
  };
  return (
    <div ref={box} className="relative w-full min-w-0 overflow-hidden">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block"
        role="img"
        aria-label="Revenue by week, against the month before"
      >
        {ys.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--color-hairline)" />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" className="fill-mist text-[11px] tnum">
              {short(v)}
            </text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const mid = PAD.l + slot * i + slot / 2;
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: hover only shows the same numbers the table below holds
            <g key={w.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect
                x={PAD.l + slot * i}
                y={PAD.t}
                width={slot}
                height={H - PAD.t - PAD.b}
                fill={hover === i ? 'var(--color-paper)' : 'transparent'}
              />
              {rect(mid - bar - 1, w.currentMinor, 'var(--color-accent)')}
              {rect(mid + 1, w.previousMinor, 'color-mix(in srgb, var(--color-mist) 55%, transparent)')}
              <text x={mid} y={H - 4} textAnchor="middle" className="fill-mist text-[11px]">
                {w.label.replace(/^\w+ /, '')}
              </text>
            </g>
          );
        })}
      </svg>
      {h ? (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-lg border border-hairline bg-canvas px-3 py-2 text-[12.5px] shadow-[0_8px_24px_-12px_rgb(21_24_27/0.3)]"
          style={{
            left: `${((PAD.l + slot * (hover ?? 0) + slot / 2) / W) * 100}%`,
            transform: `translateX(${(hover ?? 0) >= weeks.length / 2 ? '-105%' : '5%'})`,
          }}
        >
          <p className="font-medium text-ink">
            {h.label}
            {h.days < 7 ? <span className="text-mist"> · {h.days} days</span> : null}
          </p>
          <p className="text-slate tnum">This month: {short(h.currentMinor)}</p>
          <p className="text-slate tnum">Month before: {short(h.previousMinor)}</p>
        </div>
      ) : null}
      <table className="sr-only">
        <caption>Revenue by week</caption>
        <tbody>
          {weeks.map((w) => (
            <tr key={w.label}>
              <th>{w.label}</th>
              <td>{short(w.currentMinor)}</td>
              <td>{short(w.previousMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export function RevenueOverview({
  orgId,
  locale,
  thisMonth,
}: {
  orgId: string;
  locale: string;
  thisMonth: string;
}) {
  const [month, setMonth] = useState(thisMonth);
  const q = useRevenue(orgId, month);
  const r = q.data;
  const before = shiftMonth(month, -1);
  const picker = (
    <div className="inline-flex items-center gap-1 rounded-full border border-hairline p-[3px]">
      <button
        type="button"
        aria-label="Month before"
        onClick={() => setMonth(before)}
        className="flex size-8 items-center justify-center rounded-full text-slate hover:bg-linen hover:text-ink"
      >
        <IconChevronLeft size={16} stroke={1.75} aria-hidden />
      </button>
      <span className="min-w-[124px] text-center text-[13px] font-medium text-ink">
        {MONTH.format(new Date(`${month}-01T00:00:00Z`))}
      </span>
      <button
        type="button"
        aria-label="Month after"
        onClick={() => setMonth(shiftMonth(month, 1))}
        className="flex size-8 items-center justify-center rounded-full text-slate hover:bg-linen hover:text-ink"
      >
        <IconChevronRight size={16} stroke={1.75} aria-hidden />
      </button>
    </div>
  );
  return (
    <section aria-labelledby="revenue">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="revenue" className="text-[20px] font-semibold tracking-[-0.015em] text-ink">
          Revenue
        </h2>
        {picker}
      </div>
      {!r ? (
        <Spinner size={16} />
      ) : (
        <div className={`grid grid-cols-1 gap-4 lg:grid-cols-2 ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
          <div className="rounded-2xl border border-hairline bg-canvas p-5">
            <p className="text-[13px] text-slate">Average daily rate</p>
            <div className="mt-1 mb-4 flex flex-wrap items-center gap-2.5">
              <p className="text-[26px] leading-none font-semibold tracking-[-0.02em] text-ink tnum">
                {r.adr.currentMinor === null ? '—' : money(r.adr.currentMinor, r.currency, locale)}
              </p>
              <Change now={r.adr.currentMinor} before={r.adr.previousMinor} />
            </div>
            <AdrChart r={r} locale={locale} />
            <Legend month={month} before={before} />
          </div>
          <div className="rounded-2xl border border-hairline bg-canvas p-5">
            <p className="text-[13px] text-slate">Total revenue</p>
            <div className="mt-1 mb-4 flex flex-wrap items-center gap-2.5">
              <p className="text-[26px] leading-none font-semibold tracking-[-0.02em] text-ink tnum">
                {money(r.total.currentMinor, r.currency, locale)}
              </p>
              <Change now={r.total.currentMinor} before={r.total.previousMinor} />
            </div>
            <WeekBars r={r} locale={locale} />
            <Legend month={month} before={before} />
          </div>
        </div>
      )}
      <p className="mt-2 text-[12px] text-mist">Confirmed bookings, each spread over the nights it covers.</p>
    </section>
  );
}

type Metric = 'checkIns' | 'checkOuts' | 'turnovers' | 'occupancy';
const METRICS: { id: Metric; label: string }[] = [
  { id: 'checkIns', label: 'Check-ins' },
  { id: 'checkOuts', label: 'Check-outs' },
  { id: 'turnovers', label: 'Turnovers' },
  { id: 'occupancy', label: 'Occupancy' },
];

function TrendBars({ t, metric }: { t: Trends; metric: Metric }) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, W] = useWidth();
  const days = t.days;
  const values = days.map((d) => d[metric]);
  const max = metric === 'occupancy' ? 100 : Math.max(1, ...values);
  const ys = metric === 'occupancy' ? [0, 25, 50, 75, 100] : ticks(max).filter((v) => Number.isInteger(v));
  const top = ys.at(-1) ?? 1;
  const y = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  const slot = (W - PAD.l - PAD.r) / days.length;
  const bar = Math.max(4, Math.min(28, slot - 4));
  const fmt = (v: number) => (metric === 'occupancy' ? `${Math.round(v)}%` : String(v));
  const h = hover === null ? null : days[hover];
  return (
    <div ref={box} className="relative w-full min-w-0 overflow-hidden">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block"
        role="img"
        aria-label={`${METRICS.find((m) => m.id === metric)?.label}, day by day`}
      >
        {ys.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--color-hairline)" />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" className="fill-mist text-[11px] tnum">
              {fmt(v)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const v = d[metric];
          const mid = PAD.l + slot * i + slot / 2;
          const yt = y(v);
          const height = H - PAD.b - yt;
          const rr = Math.min(4, height);
          const labelEvery = days.length > 7 ? 5 : 1;
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: hover only shows the same numbers the table below holds
            <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect
                x={PAD.l + slot * i}
                y={PAD.t}
                width={slot}
                height={H - PAD.t - PAD.b}
                fill={hover === i ? 'var(--color-paper)' : 'transparent'}
              />
              {height > 0 ? (
                <path
                  d={`M${mid - bar / 2},${H - PAD.b}V${yt + rr}q0,-${rr} ${rr},-${rr}h${bar - 2 * rr}q${rr},0 ${rr},${rr}V${H - PAD.b}Z`}
                  fill="var(--color-accent)"
                />
              ) : null}
              {i % labelEvery === 0 ? (
                <text
                  x={mid}
                  y={H - 4}
                  textAnchor="middle"
                  className={`text-[11px] ${i === 0 ? 'fill-ink' : 'fill-mist'}`}
                >
                  {i === 0
                    ? 'Today'
                    : days.length > 7
                      ? DAY_SHORT.format(at(d.date))
                      : WEEKDAY.format(at(d.date))}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {h ? (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-lg border border-hairline bg-canvas px-3 py-2 text-[12.5px] shadow-[0_8px_24px_-12px_rgb(21_24_27/0.3)]"
          style={{
            left: `${((PAD.l + slot * (hover ?? 0) + slot / 2) / W) * 100}%`,
            transform: `translateX(${(hover ?? 0) >= days.length / 2 ? '-105%' : '5%'})`,
          }}
        >
          <p className="font-medium text-ink">{DAY_LONG.format(at(h.date))}</p>
          <p className="text-slate tnum">
            {h.checkIns} in · {h.checkOuts} out · {h.turnovers} turnovers
          </p>
          <p className="text-slate tnum">{Math.round(h.occupancy)}% occupied</p>
        </div>
      ) : null}
      <table className="sr-only">
        <caption>The coming days</caption>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <th>{DAY_LONG.format(at(d.date))}</th>
              <td>{d.checkIns} check-ins</td>
              <td>{d.checkOuts} check-outs</td>
              <td>{d.turnovers} turnovers</td>
              <td>{d.occupancy}% occupied</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TrendsOverview({ orgId }: { orgId: string }) {
  const [days, setDays] = useState<7 | 30>(7);
  const [metric, setMetric] = useState<Metric>('checkIns');
  const q = useTrends(orgId, days);
  const t = q.data;
  return (
    <Panel
      id="trends"
      title="Trends overview"
      sub={`The next ${days} days`}
      end={
        <Segmented
          label="How far ahead"
          value={days}
          onChange={setDays}
          options={[
            { value: 7, label: '7 days' },
            { value: 30, label: '30 days' },
          ]}
        />
      }
    >
      {!t ? (
        <Spinner size={16} />
      ) : (
        <div className={q.isPlaceholderData ? 'opacity-60' : ''}>
          <div
            role="tablist"
            aria-label="What to chart"
            className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4"
          >
            {METRICS.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={metric === m.id}
                onClick={() => setMetric(m.id)}
                className={`rounded-xl border px-4 py-3 text-left transition-colors ${metric === m.id ? 'border-accent bg-accent-tint/40' : 'border-hairline hover:border-edge'}`}
              >
                <span className="block text-[13px] text-slate">{m.label}</span>
                <span className="mt-0.5 block text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink tnum">
                  {m.id === 'occupancy' ? `${Math.round(t.totals.occupancy)}%` : t.totals[m.id]}
                </span>
              </button>
            ))}
          </div>
          <TrendBars t={t} metric={metric} />
        </div>
      )}
    </Panel>
  );
}
