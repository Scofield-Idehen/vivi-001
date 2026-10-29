import { IconChevronRight, IconSearch, IconX } from '@tabler/icons-react';
import { can, formatMoney, nightsBetween, type ReservationSummary, type ReservationView } from '@v01/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { PageLoading } from '../../components/Spinner.tsx';
import { Button, EmptyState, Notice, PageHeader } from '../../components/ui.tsx';
import { ApiError, useReservations, useWorkspace } from '../../lib/api.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { datesLabel, partyLabel, whenLabel } from './model.ts';
import { NewBookingSheet } from './NewBookingSheet.tsx';
import { ChannelName, StatusLabel } from './parts.tsx';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

const VIEWS: { value: ReservationView; label: string; empty: string }[] = [
  {
    value: 'upcoming',
    label: 'Upcoming',
    empty: 'No bookings coming up. New ones from the channels appear here as they arrive.',
  },
  { value: 'past', label: 'Past', empty: 'No finished stays yet.' },
  { value: 'cancelled', label: 'Cancelled', empty: 'No cancelled bookings.' },
];

/** A value that settles a moment after typing stops, so a search isn't sent for every key. */
function useSettled<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/**
 * Every booking from every channel (design phase D1): who is coming and staying, who has been,
 * and what was cancelled. A search finds a guest, a channel's code or a property.
 */
export function Reservations() {
  const { orgId, entry } = useCurrentWorkspace();
  const canAdd = can(entry.role, 'reservations.write');
  const [adding, setAdding] = useState(false);
  const workspace = useWorkspace(orgId);
  const locale = workspace.data?.settings.locale ?? 'en-GB';
  const navigate = useNavigate();
  const [view, setView] = useState<ReservationView>('upcoming');
  // Opened from a property's page, the search starts on that property.
  const [params] = useSearchParams();
  const [search, setSearch] = useState(() => params.get('q') ?? '');
  const query = useSettled(search);
  const list = useReservations(orgId, view, query);
  const rows = list.data?.reservations ?? [];
  const today = list.data?.today ?? '';
  const money = (r: ReservationSummary) =>
    r.totalMinor !== null && r.currency
      ? formatMoney({ amountMinor: r.totalMinor, currency: r.currency }, locale)
      : '';
  const current = VIEWS.find((v) => v.value === view) ?? VIEWS[0];

  return (
    <>
      <PageHeader
        title="Reservations"
        description="Every booking from every channel. Open one for its guest, times and notes."
        action={
          canAdd ? (
            <Button variant="primary" onClick={() => setAdding(true)}>
              New booking
            </Button>
          ) : undefined
        }
      />
      {adding ? (
        <NewBookingSheet
          today={today || new Date().toISOString().slice(0, 10)}
          onClose={() => setAdding(false)}
        />
      ) : null}

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <fieldset className="flex rounded-lg border border-hairline bg-paper p-0.5">
          <legend className="sr-only">Show</legend>
          {VIEWS.map((v) => (
            <label
              key={v.value}
              className={cx(
                'cursor-pointer rounded-md px-3.5 py-1.5 text-[13.5px] transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
                view === v.value
                  ? 'bg-canvas font-medium text-ink shadow-[0_1px_2px_rgb(21_24_27/0.1)]'
                  : 'text-slate hover:text-ink',
              )}
            >
              <input
                type="radio"
                name="reservation-view"
                value={v.value}
                checked={view === v.value}
                onChange={() => setView(v.value)}
                className="sr-only"
              />
              {v.label}
            </label>
          ))}
        </fieldset>
        <div className="relative w-full max-w-[320px] sm:w-[280px]">
          <IconSearch
            size={15}
            stroke={1.75}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-mist"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search by guest, booking code or property"
            placeholder="Guest, code or property"
            autoComplete="off"
            spellCheck={false}
            className="h-9 w-full rounded-md border border-hairline bg-canvas pr-8 pl-8 text-[13.5px] text-ink placeholder:text-mist focus:border-accent focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear the search"
              onClick={() => setSearch('')}
              className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 place-items-center rounded text-mist hover:text-ink"
            >
              <IconX size={14} stroke={2} aria-hidden />
            </button>
          ) : null}
        </div>
        {list.data ? (
          <p className="tnum text-[13px] text-slate" aria-live="polite">
            {rows.length === 1 ? '1 booking' : `${rows.length}${list.data.more ? '+' : ''} bookings`}
            {list.isFetching ? <span className="ml-3 text-mist">Loading</span> : null}
          </p>
        ) : null}
      </div>

      {list.error ? (
        <Notice tone="urgent">
          {list.error instanceof ApiError ? list.error.message : 'Could not load the bookings.'}
        </Notice>
      ) : !list.data ? (
        <PageLoading>Loading bookings</PageLoading>
      ) : rows.length === 0 ? (
        <EmptyState title={query.trim() ? 'No booking matches' : 'Nothing here yet'}>
          {query.trim()
            ? `Nothing ${current?.label.toLowerCase()} matches “${query.trim()}”.`
            : current?.empty}
        </EmptyState>
      ) : (
        <>
          {/* Narrow screens: one row per booking, nothing cut off at the side. */}
          <ul className="divide-y divide-hairline border-y border-hairline md:hidden">
            {rows.map((r) => (
              <li key={r.id}>
                <Link to={`/reservations/${r.id}`} className="flex items-center gap-3 py-3.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold tracking-[-0.015em] text-[16px] text-ink">
                      {r.guestName ?? 'Guest'}
                    </span>
                    <span className="block truncate text-[12.5px] text-slate">
                      {datesLabel(r.checkIn, r.checkOut)}, {r.propertyName}
                    </span>
                    <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate">
                      <ChannelName channel={r.channel} />
                      {r.status !== 'confirmed' ? <StatusLabel status={r.status} /> : null}
                    </span>
                  </span>
                  <IconChevronRight size={17} stroke={1.75} aria-hidden className="shrink-0 text-mist" />
                </Link>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[860px] border-collapse text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-hairline text-[12.5px] text-mist">
                  <th scope="col" className="py-2.5 pr-4 font-normal">
                    Guest
                  </th>
                  <th scope="col" className="py-2.5 pr-4 font-normal">
                    Property
                  </th>
                  <th scope="col" className="py-2.5 pr-4 font-normal">
                    Stay
                  </th>
                  <th scope="col" className="py-2.5 pr-4 font-normal">
                    Guests
                  </th>
                  <th scope="col" className="py-2.5 pr-4 font-normal">
                    Channel
                  </th>
                  <th scope="col" className="py-2.5 pr-6 text-right font-normal">
                    Total
                  </th>
                  <th scope="col" className="py-2.5 font-normal">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((r) => {
                  const nights = nightsBetween(r.checkIn, r.checkOut);
                  return (
                    <tr
                      key={r.id}
                      // The name is the link for keyboards and screen readers; the whole row works for a mouse.
                      onClick={() => navigate(`/reservations/${r.id}`)}
                      className="h-16 cursor-pointer transition-colors hover:bg-linen"
                    >
                      <td className="py-2 pr-4">
                        <Link
                          to={`/reservations/${r.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-semibold tracking-[-0.015em] text-[16px] text-ink"
                        >
                          {r.guestName ?? 'Guest'}
                        </Link>
                        <div className="text-[12.5px] text-mist">{whenLabel(r, today)}</div>
                      </td>
                      <td className="py-2 pr-4 text-slate">{r.propertyName}</td>
                      <td className="py-2 pr-4">
                        <div className="text-ink">{datesLabel(r.checkIn, r.checkOut)}</div>
                        <div className="text-[12.5px] text-mist">
                          {nights === 1 ? '1 night' : `${nights} nights`}
                        </div>
                      </td>
                      <td className="py-2 pr-4 text-slate">{partyLabel(r)}</td>
                      <td className="py-2 pr-4 whitespace-nowrap text-ink">
                        <ChannelName channel={r.channel} />
                      </td>
                      <td className="tnum py-2 pr-6 text-right text-ink">{money(r)}</td>
                      <td className="py-2 whitespace-nowrap text-slate">
                        <StatusLabel status={r.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {list.data.more ? (
            <p className="mt-4 text-[13px] text-slate">
              Showing the first {rows.length}. Search for a guest, code or property to find others.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
