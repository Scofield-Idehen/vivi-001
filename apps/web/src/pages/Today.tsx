import {
  type AttentionItem,
  CHANNEL_LABELS,
  can,
  formatMoney,
  type Glance,
  type TodayStay,
} from '@v01/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Spinner } from '../components/Spinner.tsx';
import { Notice, SectionHeading, type Status, StatusDot } from '../components/ui.tsx';
import { ApiError, useProperties, useToday, useWorkspace } from '../lib/api.ts';
import { plural, relativeTime, useNow, V01 } from '../lib/format.ts';
import { useCurrentWorkspace } from '../lib/workspace.tsx';
import { ChannelMark } from './calendar/marks.tsx';

interface Milestone {
  id: string;
  status: Status;
  label: React.ReactNode;
  when: string;
}

/**
 * What needs a person, first. Each row is the click target (no underlines: decisions, 19 Oct 2026),
 * and takes the reader to where the problem is dealt with.
 */
function NeedsAttention({
  items,
  workerSeenAt,
  now,
}: {
  items: AttentionItem[];
  workerSeenAt: string | null;
  now: number;
}) {
  const navigate = useNavigate();
  if (items.length === 0) {
    return (
      <StatusDot status="done">
        Nothing needs you right now.
        {workerSeenAt
          ? ` ${V01} last synced with the channels ${relativeTime(workerSeenAt, now)}.`
          : ` ${V01}'s sync worker hasn't reported in yet.`}
      </StatusDot>
    );
  }
  return (
    <ul className="divide-y divide-hairline rounded-2xl border border-hairline">
      {items.map((item) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: the title inside is the link; this only widens its target
        <li
          key={item.id}
          onClick={item.to ? () => navigate(item.to as string) : undefined}
          className={`flex gap-3 px-4 py-3 ${item.to ? 'cursor-pointer transition-colors hover:bg-linen first:rounded-t-2xl last:rounded-b-2xl' : ''}`}
        >
          <span
            aria-hidden
            className={`mt-[7px] size-[9px] shrink-0 rounded-full ${item.severity === 'urgent' ? 'bg-urgent' : 'bg-pending'}`}
          />
          <div className="min-w-0">
            <p className="text-[14.5px] font-medium text-ink">
              {item.to ? (
                <Link to={item.to} onClick={(e) => e.stopPropagation()}>
                  {item.title}
                </Link>
              ) : (
                item.title
              )}
            </p>
            {item.detail ? (
              <p className="mt-0.5 text-[13.5px] leading-relaxed text-slate">{item.detail}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

const DAY_SHORT = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
const DAY_LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const at = (day: string) => new Date(`${day}T12:00:00`);

function greeting(timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(new Date()),
  );
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** One headline number: the figure big, what it is under it, and where to go for more. */
function Stat({
  label,
  value,
  detail,
  to,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  to?: string;
  tone?: 'urgent' | 'pending';
}) {
  const body = (
    <>
      <p className="text-[12.5px] text-slate">{label}</p>
      <p className="font-serif text-[30px] leading-none text-ink tnum">
        {value}
        {tone ? (
          <span
            aria-hidden
            className={`ml-2 inline-block size-2.5 rounded-full align-middle ${tone === 'urgent' ? 'bg-urgent' : 'bg-pending'}`}
          />
        ) : null}
      </p>
      {detail ? <p className="text-[12.5px] text-mist">{detail}</p> : null}
    </>
  );
  const box = 'flex flex-col gap-1.5 rounded-2xl bg-paper px-4 py-3.5';
  return to ? (
    <Link to={to} className={`${box} transition-colors hover:bg-linen`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

/**
 * How full the next two weeks are: one bar a night, homes with a guest in out of all homes. One
 * series, so one hue and no legend; the value of a night shows on hover or focus, and the table
 * underneath reads the same for a screen reader.
 */
function OccupancyChart({ nights, homes }: { nights: Glance['nights']; homes: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = Math.max(homes, 1);
  const average = nights.length
    ? nights.reduce((sum, n) => sum + n.occupied, 0) / (nights.length * total)
    : 0;
  const shown = hover === null ? null : nights[hover];
  return (
    <section aria-labelledby="occupancy" className="rounded-2xl border border-hairline p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h2 id="occupancy" className="font-serif text-[20px] text-ink">
            The next two weeks
          </h2>
          <p className="text-[13px] text-slate">Homes with a guest in, each night</p>
        </div>
        <p className="text-[13px] text-slate" aria-live="polite">
          {shown ? (
            <>
              <span className="text-ink">{DAY_LONG.format(at(shown.date))}</span>: {shown.occupied} of {homes}{' '}
              {homes === 1 ? 'home' : 'homes'}
            </>
          ) : (
            <>
              <span className="font-serif text-[22px] text-ink tnum">{Math.round(average * 100)}%</span> full
              on average
            </>
          )}
        </p>
      </div>
      <div className="flex h-40 items-end gap-[2px]">
        {nights.map((n, i) => {
          const share = n.occupied / total;
          return (
            <button
              key={n.date}
              type="button"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              aria-label={`${DAY_LONG.format(at(n.date))}: ${n.occupied} of ${homes}`}
              className="group flex h-full flex-1 flex-col justify-end rounded-t-[4px] focus:outline-none"
            >
              <span
                className={`block w-full rounded-t-[4px] transition-colors ${hover === i ? 'bg-ink' : 'bg-accent'} ${share === 0 ? 'h-[2px] !bg-hairline' : ''}`}
                style={share === 0 ? undefined : { height: `${Math.max(share * 100, 3)}%` }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex gap-[2px] text-center text-[11px] text-mist" aria-hidden>
        {nights.map((n, i) => (
          <span key={n.date} className={`flex-1 ${i === 0 ? 'font-medium text-ink' : ''}`}>
            {i === 0 ? 'Now' : DAY_SHORT.format(at(n.date)).slice(0, 2)}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Homes with a guest in, the next 14 nights</caption>
        <tbody>
          {nights.map((n) => (
            <tr key={n.date}>
              <th>{DAY_LONG.format(at(n.date))}</th>
              <td>
                {n.occupied} of {homes}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function MoneyCard({ money, locale }: { money: NonNullable<Glance['money']>; locale: string }) {
  const fmt = (minor: number) =>
    formatMoney({ amountMinor: minor, currency: money.currency }, locale).replace(/\.00$/, '');
  const change =
    money.lastMonthMinor > 0
      ? Math.round(((money.thisMonthMinor - money.lastMonthMinor) / money.lastMonthMinor) * 100)
      : null;
  return (
    <section aria-labelledby="money" className="flex flex-col gap-4 rounded-2xl border border-hairline p-5">
      <h2 id="money" className="font-serif text-[20px] text-ink">
        Booked
      </h2>
      <div>
        <p className="text-[12.5px] text-slate">Stays arriving this month</p>
        <p className="font-serif text-[32px] leading-tight text-ink tnum">{fmt(money.thisMonthMinor)}</p>
        <p className="text-[12.5px] text-mist">
          {change === null
            ? 'Nothing last month to compare with'
            : `${change >= 0 ? 'Up' : 'Down'} ${Math.abs(change)}% on last month (${fmt(money.lastMonthMinor)})`}
        </p>
      </div>
      <div className="border-t border-hairline pt-3">
        <p className="text-[12.5px] text-slate">Arriving in the next 30 days</p>
        <p className="font-serif text-[24px] leading-tight text-ink tnum">{fmt(money.next30Minor)}</p>
      </div>
      <p className="mt-auto text-[11.5px] leading-snug text-mist">
        Totals from confirmed bookings, by arrival date.
      </p>
    </section>
  );
}

/** Where bookings come from: one bar per channel, length by count, the number beside it. */
function Channels({ channels }: { channels: Glance['channels'] }) {
  const most = Math.max(1, ...channels.map((c) => c.bookings));
  const all = channels.reduce((sum, c) => sum + c.bookings, 0);
  return (
    <section aria-labelledby="channels" className="rounded-2xl border border-hairline p-5">
      <h2 id="channels" className="font-serif text-[20px] text-ink">
        Where bookings come from
      </h2>
      <p className="mb-4 text-[13px] text-slate">Confirmed bookings made in the last 90 days</p>
      {channels.length === 0 ? (
        <p className="text-[14px] text-slate">No bookings in the last 90 days yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {channels.map((c) => (
            <li
              key={c.channel}
              className="grid grid-cols-[120px_minmax(0,1fr)_56px] items-center gap-3 text-[13.5px]"
            >
              <span className="flex items-center gap-2 truncate text-ink">
                <ChannelMark channel={c.channel} size={18} />
                {CHANNEL_LABELS[c.channel]}
              </span>
              <span className="h-2.5 rounded-full bg-linen">
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${(c.bookings / most) * 100}%` }}
                />
              </span>
              <span className="text-right text-slate tnum">
                {c.bookings}
                <span className="text-mist"> · {Math.round((c.bookings / all) * 100)}%</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Arrivals or departures for the day, with each arriving home's clean state beside it. */
function DayList({
  id,
  title,
  stays,
  empty,
  dirty,
}: {
  id: string;
  title: string;
  stays: TodayStay[];
  empty: string;
  dirty?: Set<string>;
}) {
  const navigate = useNavigate();
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-hairline">
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline px-5 py-3.5">
        <h2 id={id} className="font-serif text-[20px] text-ink">
          {title}
        </h2>
        <span className="font-serif text-[22px] text-ink tnum">{stays.length}</span>
      </div>
      {stays.length === 0 ? (
        <p className="px-5 py-4 text-[14px] text-slate">{empty}</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {stays.map((s) => {
            const notReady = dirty?.has(s.propertyId);
            return (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the property name inside is the link; this only widens its target
              <li
                key={s.reservationId}
                onClick={() => navigate(`/reservations/${s.reservationId}`)}
                className="flex cursor-pointer items-center gap-3 px-5 py-3 transition-colors last:rounded-b-2xl hover:bg-linen"
              >
                <span className="w-12 shrink-0 font-serif text-[18px] text-ink tnum">{s.time ?? '—'}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14.5px] text-ink">
                    <Link to={`/reservations/${s.reservationId}`} onClick={(e) => e.stopPropagation()}>
                      {s.guestName ?? CHANNEL_LABELS[s.channel]}
                    </Link>
                  </p>
                  <p className="truncate text-[12.5px] text-slate">
                    {s.propertyName} · {plural(s.guests, 'guest')} · {plural(s.nights, 'night')}
                  </p>
                </div>
                {dirty ? (
                  notReady ? (
                    <span className="shrink-0 rounded-full bg-pending/15 px-2 py-0.5 text-[11.5px] font-medium text-pending-text">
                      Not cleaned yet
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-done/12 px-2 py-0.5 text-[11.5px] font-medium text-done-text">
                      Ready
                    </span>
                  )
                ) : null}
                <ChannelMark channel={s.channel} size={20} />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function Today() {
  const { orgId, entry } = useCurrentWorkspace();
  const workspace = useWorkspace(orgId);
  const today = useToday(orgId);
  const now = useNow();
  const canSeeProperties = can(entry.role, 'properties.read');
  const properties = useProperties(canSeeProperties ? orgId : null);

  const timeZone = workspace.data?.settings.timeZone ?? 'Europe/London';
  const locale = workspace.data?.settings.locale ?? 'en-GB';
  const title = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date());

  const count = properties.data?.properties.length ?? 0;
  const live = properties.data?.properties.filter((p) => p.managedBy === 'v01').length ?? 0;
  const milestones: Milestone[] = [
    {
      id: 'workspace',
      status: 'done',
      label: `Workspace set up for ${entry.organisationName}`,
      when: 'Phase 0',
    },
    canSeeProperties && count > 0
      ? {
          id: 'properties',
          status: 'done',
          label: `${count} ${count === 1 ? 'property' : 'properties'} added`,
          when: 'Phase 0',
        }
      : {
          id: 'properties',
          status: 'pending',
          label: canSeeProperties ? (
            <Link to="/properties">Add your properties</Link>
          ) : (
            'Properties are being added'
          ),
          when: 'Phase 0',
        },
    {
      id: 'channels',
      status: 'pending',
      label:
        live > 0
          ? `${live} of ${count} ${count === 1 ? 'property' : 'properties'} run through ${V01}; connect the channel accounts and link every listing`
          : 'Connect the channel accounts and link every listing',
      when: 'Phase 1',
    },
    { id: 'certification', status: 'pending', label: 'Channex certification', when: 'Week 7' },
    {
      id: 'switch-off',
      status: 'pending',
      label: 'Move every property across, then switch off Guesty',
      when: 'Week 17',
    },
  ];

  const d = today.data;
  const g = d?.glance;
  const dirty = new Set(d?.cleansDue.map((c) => c.propertyId) ?? []);
  const tonight = g?.nights[0]?.occupied ?? d?.staying ?? 0;

  return (
    <>
      <header className="mb-6">
        <p className="text-[13.5px] text-slate">
          {greeting(timeZone)}, {title}
        </p>
        <h1 className="mt-1 font-serif text-[34px] leading-[1.1] font-normal tracking-[-0.01em] text-ink">
          {workspace.data?.brand.displayName ?? entry.organisationName}
        </h1>
      </header>

      {today.isPending ? (
        <span className="inline-flex items-center gap-2 text-[14px] text-slate">
          <Spinner size={16} /> Loading today
        </span>
      ) : today.error && !d ? (
        <Notice tone="urgent">
          {today.error instanceof ApiError ? today.error.message : 'Today couldn’t be loaded. Try again.'}
        </Notice>
      ) : d && g ? (
        <div className="flex flex-col gap-6">
          <section aria-labelledby="attention">
            <h2 id="attention" className="sr-only">
              Needs attention
            </h2>
            {d.attention.length ? (
              <NeedsAttention items={d.attention} workerSeenAt={d.workerSeenAt} now={now} />
            ) : (
              <div className="rounded-2xl bg-done/10 px-4 py-3">
                <NeedsAttention items={[]} workerSeenAt={d.workerSeenAt} now={now} />
              </div>
            )}
          </section>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5 [&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1">
            <Stat
              label="In tonight"
              value={
                <>
                  {tonight}
                  <span className="text-[18px] text-mist"> / {g.homes}</span>
                </>
              }
              detail={g.homes ? `${Math.round((tonight / g.homes) * 100)}% of homes` : 'No homes yet'}
              to="/calendar"
            />
            <Stat
              label="Arriving today"
              value={d.arrivals.length}
              detail={`${plural(d.departures.length, 'departure')}`}
              to="/reservations"
            />
            <Stat
              label="Jobs today"
              value={g.jobs.open}
              detail={
                g.jobs.unassigned
                  ? `${g.jobs.unassigned} with nobody on it`
                  : `${g.jobs.doneToday} done today`
              }
              to="/tasks"
              tone={g.jobs.unassigned ? 'pending' : undefined}
            />
            <Stat
              label="Guests waiting"
              value={g.awaitingReply}
              detail={g.awaitingReply ? 'for a reply' : 'Everyone answered'}
              to="/inbox"
              tone={g.awaitingReply ? 'pending' : undefined}
            />
            <Stat label="New bookings" value={g.newBookings} detail="in the last 7 days" to="/reservations" />
          </div>

          <div className={`grid gap-6 ${g.money ? 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]' : ''}`}>
            <OccupancyChart nights={g.nights} homes={g.homes} />
            {g.money ? <MoneyCard money={g.money} locale={locale} /> : null}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <DayList
              id="arrivals"
              title="Checking in"
              stays={d.arrivals}
              empty="No one arrives today."
              dirty={canSeeProperties ? dirty : undefined}
            />
            <DayList id="departures" title="Checking out" stays={d.departures} empty="No one leaves today." />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {g.channels.length || g.money ? <Channels channels={g.channels} /> : null}
            {canSeeProperties ? (
              <section aria-labelledby="cleans" className="rounded-2xl border border-hairline">
                <div className="flex items-baseline justify-between gap-3 border-b border-hairline px-5 py-3.5">
                  <h2 id="cleans" className="font-serif text-[20px] text-ink">
                    Cleans due
                  </h2>
                  <span className="font-serif text-[22px] text-ink tnum">{d.cleansDue.length}</span>
                </div>
                {d.cleansDue.length === 0 ? (
                  <p className="px-5 py-4 text-[14px] text-slate">Every home is clean.</p>
                ) : (
                  <CleansDue cleans={d.cleansDue} now={now} />
                )}
              </section>
            ) : null}
          </div>

          <section aria-labelledby="switch-off" className="mt-4">
            <SectionHeading id="switch-off">Getting to switch-off</SectionHeading>
            <ol className="max-w-[720px] divide-y divide-hairline border-y border-hairline">
              {milestones.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-6 py-3 text-[14px]">
                  <StatusDot status={m.status}>{m.label}</StatusDot>
                  <span className="shrink-0 text-[13px] text-mist">{m.when}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}
    </>
  );
}

function CleansDue({
  cleans,
  now,
}: {
  cleans: { propertyId: string; propertyName: string; since: string | null }[];
  now: number;
}) {
  const navigate = useNavigate();
  return (
    <ul className="divide-y divide-hairline">
      {cleans.map((c) => (
        // biome-ignore lint/a11y/useKeyWithClickEvents: the property name inside is the link; this only widens its target
        <li
          key={c.propertyId}
          onClick={() => navigate(`/properties/${c.propertyId}`)}
          className="flex cursor-pointer items-center justify-between gap-4 px-5 py-3 transition-colors last:rounded-b-2xl hover:bg-linen"
        >
          <Link
            to={`/properties/${c.propertyId}`}
            onClick={(e) => e.stopPropagation()}
            className="text-[14.5px] text-ink"
          >
            {c.propertyName}
          </Link>
          <span className="shrink-0 text-[13px] text-mist">
            {c.since ? `dirty since ${relativeTime(c.since, now)}` : 'dirty'}
          </span>
        </li>
      ))}
    </ul>
  );
}
