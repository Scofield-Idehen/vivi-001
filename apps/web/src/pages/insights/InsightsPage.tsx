import { IconArrowDownRight, IconArrowUpRight } from '@tabler/icons-react';
import { addDays, CHANNEL_LABELS, type Insights, type InsightsRow, minorDigits, todayIn } from '@v01/shared';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router';
import { monthName } from '../../components/MonthPicker.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import { Notice, PageHeader } from '../../components/ui.tsx';
import { ApiError, useInsights, useWorkspace } from '../../lib/api.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { ChannelMark } from '../calendar/marks.tsx';
import { moneyText } from '../properties/money.ts';
import { ticks, useWidth } from '../today/Overview.tsx';

/**
 * Insights (built 31 Oct 2026): how the homes are doing over a period, against the period before.
 * Occupancy, nightly rate, revenue and revenue per available night first; then the twelve months
 * to the period's end; then every home, owner or area side by side, and the channels. Money is
 * each booking spread over its nights; blocked nights aren't available.
 */

type Preset = 'this-month' | 'last-month' | '30' | '90' | 'year';

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'this-month', label: 'This month' },
  { id: 'last-month', label: 'Last month' },
  { id: '30', label: 'Last 30 days' },
  { id: '90', label: 'Last 90 days' },
  { id: 'year', label: 'This year' },
];

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const at = (d: string) => new Date(`${d}T12:00:00`);
const span = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

function period(p: Preset, today: string): { from: string; to: string } {
  const month = today.slice(0, 7);
  const lastDay = (m: string) => {
    const [y, mo] = m.split('-').map(Number) as [number, number];
    return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`;
  };
  if (p === 'this-month') return { from: `${month}-01`, to: lastDay(month) };
  if (p === 'last-month') {
    const prev = addDays(`${month}-01`, -1).slice(0, 7);
    return { from: `${prev}-01`, to: lastDay(prev) };
  }
  if (p === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
  const n = Number(p);
  return { from: addDays(today, -(n - 1)), to: today };
}

/** The same length of time just before. */
function before({ from, to }: { from: string; to: string }) {
  const n = span(from, to);
  return { from: addDays(from, -n), to: addDays(from, -1) };
}

function Change({
  now,
  then,
  points,
  costs,
}: {
  now: number | null;
  then: number | null;
  points?: boolean;
  /** A cost: going up is the bad direction. */
  costs?: boolean;
}) {
  if (now === null || then === null || (!points && !then))
    return <span className="text-[12px] text-mist">—</span>;
  const d = points ? Math.round((now - then) * 10) / 10 : Math.round(((now - then) / then) * 1000) / 10;
  if (d === 0) return <span className="text-[12px] text-slate">No change</span>;
  const up = d > 0;
  const good = costs ? !up : up;
  const Icon = up ? IconArrowUpRight : IconArrowDownRight;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[12.5px] font-semibold tnum ${good ? 'text-done-text' : 'text-urgent'}`}
    >
      <Icon size={14} stroke={2} aria-hidden />
      {Math.abs(d)}
      {points ? ' pts' : '%'}
    </span>
  );
}

function Tile({
  label,
  value,
  change,
  hint,
}: {
  label: string;
  value: ReactNode;
  change?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-hairline bg-canvas p-4" title={hint}>
      <p className="text-[13px] text-slate">{label}</p>
      <p className="mt-1 text-[24px] leading-tight font-semibold tracking-[-0.02em] text-ink tnum">{value}</p>
      {change ? <div className="mt-1">{change}</div> : null}
    </div>
  );
}

const H = 180;
const PAD = { l: 52, r: 8, t: 10, b: 24 };
const MONTH_SHORT = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' });
const monthShort = (m: string) => MONTH_SHORT.format(new Date(`${m}-01T00:00:00Z`));

/** Twelve bars or a line over twelve months, one measure per chart (never two scales on one). */
function MonthChart({
  months,
  value,
  format,
  kind,
  label,
}: {
  months: Insights['months'];
  value: (m: Insights['months'][number]) => number | null;
  format: (v: number) => string;
  kind: 'bars' | 'line';
  label: string;
}) {
  const [box, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const values = months.map(value);
  const max = Math.max(1, ...values.map((v) => v ?? 0));
  const ys = kind === 'line' && label.includes('ccupancy') ? [0, 25, 50, 75, 100] : ticks(max);
  const top = ys.at(-1) ?? 1;
  const y = (v: number) => PAD.t + (1 - v / top) * (H - PAD.t - PAD.b);
  const slot = (W - PAD.l - PAD.r) / months.length;
  const mid = (i: number) => PAD.l + slot * i + slot / 2;
  const bar = Math.min(26, slot * 0.6);
  const points = values.map((v, i) => (v === null ? null : ([mid(i), y(v)] as const)));
  let line = '';
  points.forEach((p, i) => {
    if (!p) return;
    line += `${line && points[i - 1] ? 'L' : 'M'}${p[0]},${p[1]}`;
  });
  const h = hover === null ? null : months[hover];
  return (
    <div ref={box} className="relative w-full min-w-0 overflow-hidden">
      <svg width={W} height={H} className="block" role="img" aria-label={`${label}, month by month`}>
        {ys.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--color-hairline)" />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" className="fill-mist text-[11px] tnum">
              {format(v)}
            </text>
          </g>
        ))}
        {kind === 'line' ? (
          <path d={line} fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" />
        ) : null}
        {months.map((m, i) => {
          const v = values[i];
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: hover shows the numbers the table below holds
            <g key={m.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect
                x={PAD.l + slot * i}
                y={PAD.t}
                width={slot}
                height={H - PAD.t - PAD.b}
                fill={hover === i ? 'color-mix(in srgb, var(--color-ink) 4%, transparent)' : 'transparent'}
              />
              {kind === 'bars' && v ? (
                <path
                  d={`M${mid(i) - bar / 2},${H - PAD.b}V${y(v) + Math.min(4, H - PAD.b - y(v))}q0,-${Math.min(4, H - PAD.b - y(v))} ${Math.min(4, bar / 2)},-${Math.min(4, H - PAD.b - y(v))}h${bar - 2 * Math.min(4, bar / 2)}q${Math.min(4, bar / 2)},0 ${Math.min(4, bar / 2)},${Math.min(4, H - PAD.b - y(v))}V${H - PAD.b}Z`}
                  fill="var(--color-accent)"
                />
              ) : null}
              {kind === 'line' && v !== null && v !== undefined ? (
                <circle
                  cx={mid(i)}
                  cy={y(v)}
                  r={hover === i ? 5 : 3}
                  fill="var(--color-accent)"
                  stroke="var(--color-canvas)"
                  strokeWidth="2"
                />
              ) : null}
              {i % (W < 520 ? 2 : 1) === 0 ? (
                <text x={mid(i)} y={H - 6} textAnchor="middle" className="fill-mist text-[11px]">
                  {monthShort(m.month)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {h && hover !== null ? (
        <div
          className="pointer-events-none absolute top-0 z-10 rounded-lg border border-hairline bg-canvas px-3 py-2 text-[12.5px] shadow-[0_8px_24px_-12px_rgb(21_24_27/0.3)]"
          style={{
            left: mid(hover),
            transform: `translateX(${hover >= months.length / 2 ? 'calc(-100% - 12px)' : '12px'})`,
          }}
        >
          <p className="font-medium text-ink">{monthName(h.month)}</p>
          <p className="text-slate tnum">
            {label}: {values[hover] === null ? '—' : format(values[hover] as number)}
          </p>
        </div>
      ) : null}
      <table className="sr-only">
        <caption>{label} by month</caption>
        <tbody>
          {months.map((m, i) => (
            <tr key={m.month}>
              <th>{monthName(m.month)}</th>
              <td>{values[i] === null ? '—' : format(values[i] as number)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Column =
  | 'name'
  | 'occupancy'
  | 'adrMinor'
  | 'revenueMinor'
  | 'revparMinor'
  | 'bookings'
  | 'expensesMinor'
  | 'claimedMinor';

function Breakdown({
  d,
  money,
  by,
}: {
  d: Insights;
  money: (v: number) => string;
  by: 'homes' | 'owners' | 'areas';
}) {
  const [sort, setSort] = useState<{ col: Column; down: boolean }>({ col: 'revenueMinor', down: true });
  const rows = [...d[by]].sort((a, b) => {
    const av = a[sort.col] ?? -1;
    const bv = b[sort.col] ?? -1;
    const c = typeof av === 'string' ? String(av).localeCompare(String(bv)) : Number(av) - Number(bv);
    return sort.down ? -c : c;
  });
  const head = (col: Column, label: string, right = true) => (
    <th
      className={`px-3 py-2.5 font-normal ${right ? 'text-right' : 'text-left'}`}
      aria-sort={sort.col === col ? (sort.down ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        onClick={() => setSort((s) => ({ col, down: s.col === col ? !s.down : col !== 'name' }))}
        className={`rounded px-1 hover:text-ink ${sort.col === col ? 'font-medium text-ink' : ''}`}
      >
        {label}
        {sort.col === col ? (sort.down ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );
  const link = (r: InsightsRow) =>
    by === 'homes' ? `/properties/${r.id}` : by === 'owners' && r.id !== 'none' ? `/owners/${r.id}` : null;
  return (
    <div className="overflow-x-auto rounded-2xl border border-hairline bg-canvas">
      <table className="w-full min-w-[820px] text-[14px]">
        <thead>
          <tr className="border-b border-hairline text-[12.5px] text-slate">
            {head('name', by === 'homes' ? 'Home' : by === 'owners' ? 'Owner' : 'Area', false)}
            {head('occupancy', 'Occupancy')}
            {head('adrMinor', 'Nightly rate')}
            {head('revenueMinor', 'Revenue')}
            {head('revparMinor', 'Per available night')}
            {head('bookings', 'Arrivals')}
            {head('expensesMinor', 'Expenses')}
            {head('claimedMinor', 'Claimed')}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {rows.map((r) => {
            const to = link(r);
            return (
              <tr key={r.id} className="hover:bg-paper">
                <td className="px-4 py-2.5">
                  {to ? (
                    <Link to={to} className="font-medium text-ink hover:text-accent">
                      {r.name}
                    </Link>
                  ) : (
                    <span className="font-medium text-ink">{r.name}</span>
                  )}
                  {r.sub ? <span className="block text-[12.5px] text-slate">{r.sub}</span> : null}
                </td>
                <td className="px-4 py-2.5">
                  <span className="flex items-center justify-end gap-2">
                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-linen" aria-hidden>
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{ width: `${Math.min(100, r.occupancy)}%` }}
                      />
                    </span>
                    <span className="w-12 text-right text-ink tnum">{r.occupancy}%</span>
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-ink tnum">
                  {r.adrMinor === null ? '—' : money(r.adrMinor)}
                </td>
                <td className="px-4 py-2.5 text-right font-semibold text-ink tnum">
                  {money(r.revenueMinor)}
                </td>
                <td className="px-4 py-2.5 text-right text-ink tnum">
                  {r.revparMinor === null ? '—' : money(r.revparMinor)}
                </td>
                <td className="px-4 py-2.5 text-right text-slate tnum">{r.bookings}</td>
                <td className="px-4 py-2.5 text-right text-slate tnum">
                  {r.expensesMinor ? money(r.expensesMinor) : '—'}
                </td>
                <td className="px-4 py-2.5 text-right text-slate tnum">
                  {r.claimedMinor ? money(r.claimedMinor) : '—'}
                  {r.claimReceivedMinor ? (
                    <span className="block text-[12px] text-done-text">{money(r.claimReceivedMinor)} in</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function InsightsPage() {
  const { orgId } = useCurrentWorkspace();
  const workspace = useWorkspace(orgId);
  const locale = workspace.data?.settings.locale ?? 'en-GB';
  const today = todayIn(workspace.data?.settings.timeZone ?? 'Europe/London');
  const [preset, setPreset] = useState<Preset>('last-month');
  const [by, setBy] = useState<'homes' | 'owners' | 'areas'>('homes');
  const range = period(preset, today);
  const prev = before(range);
  const q = useInsights(orgId, range.from, range.to);
  const p = useInsights(orgId, prev.from, prev.to);
  const d = q.data;
  const pt = p.data?.totals;
  const money = (v: number) => moneyText(v, d?.currency ?? 'GBP', locale);
  // Axis labels: £1.2K rather than £1,200.
  const short = (v: number) =>
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: d?.currency ?? 'GBP',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(v / 10 ** minorDigits(d?.currency ?? 'GBP'));
  const channelTotal = d ? d.channels.reduce((t, c) => t + c.revenueMinor, 0) : 0;

  return (
    <>
      <PageHeader
        title="Insights"
        description="How the homes are doing: occupancy, nightly rate and revenue, against the period before, then home by home and channel by channel."
      />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" title="Period">
          {PRESETS.map((x) => (
            <button
              key={x.id}
              type="button"
              aria-pressed={preset === x.id}
              onClick={() => setPreset(x.id)}
              className={`h-9 rounded-full border px-4 text-[13.5px] transition-colors ${preset === x.id ? 'border-ink bg-ink text-canvas' : 'border-hairline text-ink hover:border-edge'}`}
            >
              {x.label}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-slate">
          {DAY.format(at(range.from))} – {DAY.format(at(range.to))} · against {DAY.format(at(prev.from))} –{' '}
          {DAY.format(at(prev.to))}
        </p>
      </div>

      {!d ? (
        q.isPending ? (
          <Spinner size={16} />
        ) : (
          <Notice tone="urgent">
            {q.error instanceof ApiError ? q.error.message : 'Insights couldn’t be loaded.'}
          </Notice>
        )
      ) : (
        <div className={`flex flex-col gap-8 ${q.isPlaceholderData ? 'opacity-60' : ''}`}>
          <section aria-label="The period at a glance" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label="Occupancy"
              value={`${d.totals.occupancy}%`}
              change={<Change now={d.totals.occupancy} then={pt?.occupancy ?? null} points />}
              hint={`${d.totals.bookedNights} of ${d.totals.availableNights} available nights`}
            />
            <Tile
              label="Nightly rate"
              value={d.totals.adrMinor === null ? '—' : money(d.totals.adrMinor)}
              change={<Change now={d.totals.adrMinor} then={pt?.adrMinor ?? null} />}
            />
            <Tile
              label="Revenue"
              value={money(d.totals.revenueMinor)}
              change={<Change now={d.totals.revenueMinor} then={pt?.revenueMinor ?? null} />}
            />
            <Tile
              label="Per available night"
              value={d.totals.revparMinor === null ? '—' : money(d.totals.revparMinor)}
              change={<Change now={d.totals.revparMinor} then={pt?.revparMinor ?? null} />}
              hint="Revenue divided by every night that could have been booked"
            />
            <Tile
              label="Arrivals"
              value={d.totals.bookings}
              change={<Change now={d.totals.bookings} then={pt?.bookings ?? null} />}
            />
            <Tile
              label="Average stay"
              value={d.totals.averageStay === null ? '—' : `${d.totals.averageStay} nights`}
            />
            <Tile
              label="Expenses"
              value={money(d.totals.expensesMinor)}
              change={<Change now={d.totals.expensesMinor} then={pt?.expensesMinor ?? null} costs />}
            />
            <Tile
              label="Damage claimed"
              value={money(d.totals.claimedMinor)}
              change={
                d.totals.claimedMinor ? (
                  <span className="text-[12.5px] text-slate">
                    {money(d.totals.claimReceivedMinor)} received
                  </span>
                ) : undefined
              }
            />
          </section>

          <section aria-labelledby="months" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <h2 id="months" className="sr-only">
              The twelve months to {monthName(range.to.slice(0, 7))}
            </h2>
            <div className="rounded-2xl border border-hairline bg-canvas p-5">
              <p className="mb-3 text-[15px] font-semibold text-ink">Revenue, month by month</p>
              <MonthChart
                months={d.months}
                value={(m) => m.revenueMinor}
                format={short}
                kind="bars"
                label="Revenue"
              />
            </div>
            <div className="rounded-2xl border border-hairline bg-canvas p-5">
              <p className="mb-3 text-[15px] font-semibold text-ink">Occupancy, month by month</p>
              <MonthChart
                months={d.months}
                value={(m) => m.occupancy}
                format={(v) => `${Math.round(v)}%`}
                kind="line"
                label="Occupancy"
              />
            </div>
          </section>

          <section aria-labelledby="breakdown">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 id="breakdown" className="text-[20px] font-semibold tracking-[-0.015em] text-ink">
                Side by side
              </h2>
              <div className="flex gap-2" title="Group by">
                {(
                  [
                    ['homes', 'Homes'],
                    ['owners', 'Owners'],
                    ['areas', 'Areas'],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={by === v}
                    onClick={() => setBy(v)}
                    className={`h-8 rounded-full border px-3.5 text-[13px] ${by === v ? 'border-ink bg-ink text-canvas' : 'border-hairline text-ink hover:border-edge'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <Breakdown d={d} money={money} by={by} />
          </section>

          <section aria-labelledby="channels">
            <h2 id="channels" className="mb-3 text-[20px] font-semibold tracking-[-0.015em] text-ink">
              Channels
            </h2>
            {d.channels.length ? (
              <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-canvas">
                {d.channels.map((c) => {
                  const share = channelTotal ? Math.round((c.revenueMinor / channelTotal) * 100) : 0;
                  return (
                    <li key={c.channel} className="flex flex-col gap-2 px-4 py-3">
                      <span className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2.5 text-[14.5px] font-medium text-ink">
                          <ChannelMark channel={c.channel} size={20} />
                          {CHANNEL_LABELS[c.channel]}
                        </span>
                        <span className="text-[14.5px] font-semibold text-ink tnum">
                          {money(c.revenueMinor)}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        <span className="h-2 flex-1 overflow-hidden rounded-full bg-linen" aria-hidden>
                          <span
                            className="block h-full rounded-full bg-accent"
                            style={{ width: `${share}%` }}
                          />
                        </span>
                        <span className="w-10 text-right text-[13px] text-ink tnum">{share}%</span>
                      </span>
                      <span className="text-[13px] text-slate tnum">
                        {c.bookings} {c.bookings === 1 ? 'arrival' : 'arrivals'}
                        {c.adrMinor !== null ? ` · ${money(c.adrMinor)} a night` : ''}
                        {c.leadDays !== null ? ` · booked ${c.leadDays} days ahead on average` : ''}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[14px] text-slate">No booked nights in this period.</p>
            )}
          </section>
          <p className="text-[12px] text-mist">
            Confirmed bookings only. Each booking’s total is spread over its nights, so a period counts the
            nights that fall in it. Blocked nights aren’t counted as available.
          </p>
        </div>
      )}
    </>
  );
}
