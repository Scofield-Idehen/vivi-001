import { IconArrowLeft } from '@tabler/icons-react';
import { CHANNEL_LABELS, can, type TodayStay, todayIn } from '@v01/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Spinner } from '../components/Spinner.tsx';
import { Notice, PageHeader } from '../components/ui.tsx';
import { ApiError, useMe, useToday, useWorkspace } from '../lib/api.ts';
import { plural, relativeTime, useNow } from '../lib/format.ts';
import { useCurrentWorkspace } from '../lib/workspace.tsx';
import { ChannelMark } from './calendar/marks.tsx';
import { NotFound } from './misc.tsx';
import { DailyOverview, RevenueOverview, TrendsOverview } from './today/Overview.tsx';

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
 * Today, after Guesty's dashboard (Alpha, 29 Oct 2026): welcome, the daily overview (who is in, who
 * is out, turnovers, who is staying), revenue for a month against the one before, the trend of the
 * coming days, then the day's lists, four cards each with "View all" for the rest.
 */
export function Today() {
  const { orgId, entry, workspace, today, now, d, dirty, counts, lists } = useTodayParts();
  const me = useMe();
  const timeZone = workspace.data?.settings.timeZone ?? 'Europe/London';
  const locale = workspace.data?.settings.locale ?? 'en-GB';
  const [picked, setPicked] = useState<ListId | null>(null);
  const tab = picked ?? lists.find((l) => counts[l] > 0) ?? 'leaving';
  const name = me.data?.user.fullName?.trim();
  const first = name && !name.includes('@') ? name.split(/\s+/)[0] : null;
  const canSeeProperties = can(entry.role, 'properties.read');

  return (
    <>
      <header className="mb-8">
        <h1 className="font-semibold tracking-[-0.02em] text-[26px] leading-[1.2] text-ink">
          Welcome back{first ? `, ${first}` : ''}
        </h1>
        <p className="mt-1 text-[14px] text-slate">
          {todayTitle(locale, timeZone)} · {workspace.data?.brand.displayName ?? entry.organisationName}
        </p>
      </header>

      <div className="flex flex-col gap-10">
        <DailyOverview orgId={orgId} canSeeProperties={canSeeProperties} />

        {can(entry.role, 'reservations.read') ? (
          <RevenueOverview orgId={orgId} locale={locale} thisMonth={todayIn(timeZone).slice(0, 7)} />
        ) : null}

        <TrendsOverview orgId={orgId} />

        {today.isPending ? (
          <span className="inline-flex items-center gap-2 text-[14px] text-slate">
            <Spinner size={16} /> Loading today
          </span>
        ) : today.error && !d ? (
          <Notice tone="urgent">
            {today.error instanceof ApiError ? today.error.message : 'Today couldn’t be loaded. Try again.'}
          </Notice>
        ) : d ? (
          <section aria-labelledby="your-day">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 id="your-day" className="font-semibold tracking-[-0.015em] text-[20px] text-ink">
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
        ) : null}
      </div>
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
