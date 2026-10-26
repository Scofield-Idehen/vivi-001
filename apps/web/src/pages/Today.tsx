import { IconArrowLeft } from '@tabler/icons-react';
import { CHANNEL_LABELS, can, formatMoney, type Glance, type TodayStay } from '@v01/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Spinner } from '../components/Spinner.tsx';
import { Notice, PageHeader } from '../components/ui.tsx';
import { ApiError, useToday, useWorkspace } from '../lib/api.ts';
import { plural, relativeTime, useNow } from '../lib/format.ts';
import { useCurrentWorkspace } from '../lib/workspace.tsx';
import { ChannelMark } from './calendar/marks.tsx';
import { NotFound } from './misc.tsx';

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

type ListId = 'attention' | 'arriving' | 'leaving' | 'cleans';

const LIST_TITLES: Record<ListId, string> = {
  attention: 'Needs attention',
  arriving: 'Checking in today',
  leaving: 'Checking out today',
  cleans: 'Cleans due',
};

/** How many cards a tab shows before "View all". */
const PREVIEW = 4;

function todayTitle(locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(
    new Date(),
  );
}

/** One small card in a tab: a short line on top, who or what, and where. The whole card opens it. */
function Card({
  to,
  top,
  tone,
  title,
  sub,
  end,
}: {
  to: string | null;
  top: React.ReactNode;
  tone?: 'urgent' | 'pending' | 'done';
  title: React.ReactNode;
  sub?: React.ReactNode;
  end?: React.ReactNode;
}) {
  const body = (
    <>
      <p
        className={`text-[12.5px] font-medium ${tone === 'urgent' ? 'text-urgent' : tone === 'pending' ? 'text-pending-text' : tone === 'done' ? 'text-done-text' : 'text-slate'}`}
      >
        {top}
      </p>
      <p className="mt-2 line-clamp-2 text-[15px] leading-snug text-ink">{title}</p>
      {sub ? <p className="mt-1 line-clamp-2 text-[13px] text-slate">{sub}</p> : null}
      {end ? <div className="mt-auto flex items-center justify-between gap-2 pt-3">{end}</div> : null}
    </>
  );
  const box = 'flex flex-col rounded-2xl sm:min-h-[132px] border border-hairline bg-canvas p-4';
  return to ? (
    <Link to={to} className={`${box} transition-colors hover:border-edge hover:bg-paper`}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

function ListCards({
  list,
  d,
  dirty,
  now,
  limit,
}: {
  list: ListId;
  d: NonNullable<ReturnType<typeof useToday>['data']>;
  dirty: Set<string> | undefined;
  now: number;
  limit?: number;
}) {
  const cut = <T,>(xs: T[]) => (limit ? xs.slice(0, limit) : xs);
  const stay = (s: TodayStay, word: string) => (
    <Card
      key={s.reservationId}
      to={`/reservations/${s.reservationId}`}
      top={`${word}${s.time ? ` ${s.time}` : ''}`}
      tone={list === 'arriving' && dirty?.has(s.propertyId) ? 'pending' : undefined}
      title={s.guestName ?? CHANNEL_LABELS[s.channel]}
      sub={s.propertyName}
      end={
        <>
          <span className="text-[12.5px] text-mist">
            {list === 'arriving' && dirty
              ? dirty.has(s.propertyId)
                ? 'Not cleaned yet'
                : 'Ready'
              : `${plural(s.guests, 'guest')} · ${plural(s.nights, 'night')}`}
          </span>
          <ChannelMark channel={s.channel} size={18} />
        </>
      }
    />
  );
  const cards =
    list === 'attention'
      ? cut(d.attention).map((a) => (
          <Card
            key={a.id}
            to={a.to}
            top={a.severity === 'urgent' ? 'Urgent' : 'To look at'}
            tone={a.severity === 'urgent' ? 'urgent' : 'pending'}
            title={a.title}
            sub={a.detail}
          />
        ))
      : list === 'arriving'
        ? cut(d.arrivals).map((s) => stay(s, 'Arriving'))
        : list === 'leaving'
          ? cut(d.departures).map((s) => stay(s, 'Leaving'))
          : cut(d.cleansDue).map((c) => (
              <Card
                key={c.propertyId}
                to={`/properties/${c.propertyId}`}
                top={c.since ? `Dirty since ${relativeTime(c.since, now)}` : 'Dirty'}
                tone="pending"
                title={c.propertyName}
              />
            ));
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards}</div>;
}

const EMPTY: Record<ListId, string> = {
  attention: 'Nothing needs you right now.',
  arriving: 'No one arrives today.',
  leaving: 'No one leaves today.',
  cleans: 'Every home is clean.',
};

function useTodayParts() {
  const { orgId, entry } = useCurrentWorkspace();
  const workspace = useWorkspace(orgId);
  const today = useToday(orgId);
  const now = useNow();
  const canSeeProperties = can(entry.role, 'properties.read');
  const d = today.data;
  const dirty = canSeeProperties ? new Set(d?.cleansDue.map((c) => c.propertyId) ?? []) : undefined;
  const counts: Record<ListId, number> = {
    attention: d?.attention.length ?? 0,
    arriving: d?.arrivals.length ?? 0,
    leaving: d?.departures.length ?? 0,
    cleans: d?.cleansDue.length ?? 0,
  };
  const lists: ListId[] = canSeeProperties
    ? ['attention', 'leaving', 'arriving', 'cleans']
    : ['attention', 'leaving', 'arriving'];
  return { orgId, entry, workspace, today, now, d, dirty, counts, lists };
}

/**
 * Today, kept short (Alpha, 26 Oct 2026: "keep it minimal and basic", like Airbnb's): a few numbers,
 * then one row of tabs (needs attention, checking out, checking in, cleans), each showing four
 * cards and "View all" for the rest on a page of its own, then how full the next two weeks are.
 */
export function Today() {
  const { entry, workspace, today, now, d, dirty, counts, lists } = useTodayParts();
  const timeZone = workspace.data?.settings.timeZone ?? 'Europe/London';
  const locale = workspace.data?.settings.locale ?? 'en-GB';
  const [picked, setPicked] = useState<ListId | null>(null);
  const tab = picked ?? lists.find((l) => counts[l] > 0) ?? 'leaving';
  const g = d?.glance;
  const tonight = g?.nights[0]?.occupied ?? d?.staying ?? 0;

  return (
    <>
      <header className="mb-8">
        <p className="text-[13.5px] text-slate">
          {greeting(timeZone)}, {todayTitle(locale, timeZone)}
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
        <div className="flex flex-col gap-10">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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

          <section aria-labelledby="your-day">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 id="your-day" className="font-serif text-[24px] text-ink">
                Your day
              </h2>
              {counts[tab] > PREVIEW ? (
                <Link to={`/today/${tab}`} className="action">
                  View all {counts[tab]}
                </Link>
              ) : null}
            </div>
            <div role="tablist" aria-label="Your day" className="mb-4 flex gap-2 overflow-x-auto pb-1">
              {lists.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="tab"
                  aria-selected={tab === l}
                  onClick={() => setPicked(l)}
                  className={`h-9 shrink-0 rounded-full border px-4 text-[13.5px] transition-colors ${tab === l ? 'border-ink bg-ink text-canvas' : 'border-hairline text-ink hover:border-edge'}`}
                >
                  {LIST_TITLES[l].replace(' today', '')} ({counts[l]})
                  {l === 'attention' && d.attention.some((a) => a.severity === 'urgent') ? (
                    <span
                      aria-label="urgent"
                      role="img"
                      className="ml-1.5 inline-block size-2 rounded-full bg-urgent align-middle"
                    />
                  ) : null}
                </button>
              ))}
            </div>
            <div role="tabpanel">
              {counts[tab] === 0 ? (
                <p className="rounded-2xl border border-dashed border-hairline px-5 py-8 text-center text-[14px] text-slate">
                  {EMPTY[tab]}
                </p>
              ) : (
                <ListCards list={tab} d={d} dirty={dirty} now={now} limit={PREVIEW} />
              )}
            </div>
          </section>

          <div className={`grid gap-6 ${g.money ? 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]' : ''}`}>
            <OccupancyChart nights={g.nights} homes={g.homes} />
            {g.money ? <MoneyCard money={g.money} locale={locale} /> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

/** One of Today's lists in full: /today/attention, /today/arriving, /today/leaving, /today/cleans. */
export function TodayList() {
  const { list } = useParams();
  const { today, now, d, dirty, counts, lists } = useTodayParts();
  const id = (lists as string[]).includes(list ?? '') ? (list as ListId) : null;
  if (!id) return <NotFound />;
  return (
    <>
      <Link to="/today" className="action -ml-2.5 mb-4 inline-flex items-center gap-1">
        <IconArrowLeft size={15} stroke={1.75} aria-hidden /> Today
      </Link>
      <PageHeader title={`${LIST_TITLES[id]} (${counts[id]})`} />
      {today.isPending ? (
        <Spinner size={16} />
      ) : !d ? null : counts[id] === 0 ? (
        <p className="text-[14px] text-slate">{EMPTY[id]}</p>
      ) : (
        <ListCards list={id} d={d} dirty={dirty} now={now} />
      )}
    </>
  );
}
