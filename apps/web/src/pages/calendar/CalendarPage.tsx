import { IconCalendarEvent, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { addDays, type Calendar, can, isIsoDate, todayIn } from '@v01/shared';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PageLoading } from '../../components/Spinner.tsx';
import { Button, EmptyState, Notice, PageHeader } from '../../components/ui.tsx';
import { ApiError, useCalendarPieces, useWorkspace } from '../../lib/api.ts';
import { plural } from '../../lib/format.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { type BarTarget, CalendarGrid, type GridHandle } from './CalendarGrid.tsx';
import { CalendarPanel, type PanelTarget } from './CalendarPanel.tsx';
import { CleaningBadge } from './Cleaning.tsx';
import { FilterBar } from './FilterBar.tsx';
import {
  buildRows,
  type CalendarFilters,
  type CalendarRow,
  CELL_WIDTH,
  filterChoices,
  filterProperties,
  filtersOn,
  filtersToKeep,
  mergeCalendars,
  NAME_WIDTH,
  NAME_WIDTH_NARROW,
  NO_FILTERS,
  parseFilters,
  piecesFor,
  rangeLabel,
  type Selection,
  timelineFor,
  windowLabel,
} from './model.ts';

/** Nights shown before today, so this morning's departures are on screen. */
const DAYS_BEFORE_TODAY = 2;
/** Nights fetched beyond those in view, either side, so a slow scroll never waits. */
const FETCH_AHEAD = 14;
/** The page's own padding below the grid. */
const BOTTOM_SPACE = 40;

const filtersKey = (orgId: string) => `v01.calendarFilters.${orgId}`;

/** The filters this browser kept for the workspace, or none. */
function loadFilters(orgId: string): CalendarFilters {
  try {
    const raw = localStorage.getItem(filtersKey(orgId));
    return raw ? parseFilters(JSON.parse(raw)) : NO_FILTERS;
  } catch {
    return NO_FILTERS;
  }
}

function keepFilters(orgId: string, filters: CalendarFilters): void {
  try {
    localStorage.setItem(filtersKey(orgId), JSON.stringify(filtersToKeep(filters)));
  } catch {
    // Storage can be unavailable (private windows); the filters then last until the page closes.
  }
}

/**
 * Moving through the dates: Today, a week back or forward, and the nights in view as a button that
 * opens a date picker to jump anywhere. Scrolling the calendar itself does the same.
 */
function DateNav({
  label,
  loading,
  min,
  max,
  value,
  onToday,
  onStep,
  onPick,
}: {
  label: string;
  loading: boolean;
  min: string;
  max: string;
  value: string;
  onToday(): void;
  onStep(nights: number): void;
  onPick(date: string): void;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const open = () => {
    const input = picker.current;
    if (!input) return;
    try {
      input.showPicker();
    } catch {
      input.focus();
    }
  };
  const arrow =
    'grid size-9 place-items-center border border-hairline text-ink transition-colors hover:bg-linen';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button onClick={onToday}>Today</Button>
      <div className="flex items-center">
        <button
          type="button"
          aria-label="A week earlier"
          onClick={() => onStep(-7)}
          className={`${arrow} rounded-l-md`}
        >
          <IconChevronLeft size={18} stroke={1.75} aria-hidden />
        </button>
        <div className="relative">
          <button
            type="button"
            onClick={open}
            aria-label={`Go to a date. Showing ${label}`}
            className="inline-flex h-9 items-center gap-2 border-y border-hairline px-3 text-[14px] font-medium whitespace-nowrap text-ink transition-colors hover:bg-linen"
          >
            <IconCalendarEvent size={16} stroke={1.75} aria-hidden className="text-slate" />
            <span aria-live="polite">{label}</span>
            {loading ? <span className="text-[12.5px] font-normal text-mist">Loading</span> : null}
          </button>
          <input
            ref={picker}
            type="date"
            tabIndex={-1}
            aria-label="Go to a date"
            min={min}
            max={max}
            value={value}
            onChange={(event) => {
              if (isIsoDate(event.target.value)) onPick(event.target.value);
            }}
            className="pointer-events-none absolute bottom-0 left-0 size-px opacity-0"
          />
        </div>
        <button
          type="button"
          aria-label="A week later"
          onClick={() => onStep(7)}
          className={`${arrow} rounded-r-md`}
        >
          <IconChevronRight size={18} stroke={1.75} aria-hidden />
        </button>
      </div>
    </div>
  );
}

/**
 * Every property by night (design phase D1): prices, minimum stays, bookings and blocks, with the
 * price limits behind every price, and whether each property is clean. It scrolls through a year
 * back and two years ahead, fetching four weeks at a time as they come into view. Choosing nights
 * opens a panel to change them; what changes goes to the channels for properties V-01 runs.
 */
export function CalendarPage() {
  const { orgId } = useCurrentWorkspace();
  // Another workspace starts afresh: its own filters, nothing selected.
  return <CalendarScreen key={orgId} />;
}

function CalendarScreen() {
  const { orgId, entry } = useCurrentWorkspace();
  const workspace = useWorkspace(orgId);
  const settings = workspace.data?.settings;
  const currency = settings?.currency ?? 'GBP';
  const locale = settings?.locale ?? 'en-GB';
  const timeZone = settings?.timeZone ?? 'Europe/London';
  const localToday = todayIn(timeZone);
  const editable = can(entry.role, 'calendar.write');
  const canClean = can(entry.role, 'cleaning.write');

  // The names column narrows on a phone, so more of the nights show.
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1100);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const nameWidth = width < 640 ? NAME_WIDTH_NARROW : NAME_WIDTH;

  // The grid ends at the bottom of the window and scrolls inside, wherever the filters leave its top.
  const [top, setTop] = useState(260);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const next = Math.round(element.getBoundingClientRect().top + window.scrollY);
    if (next !== top) setTop(next);
  });
  const maxHeight = `max(420px, calc(100dvh - ${top + BOTTOM_SPACE}px))`;

  // Opened from a property's page ("See its calendar"), the search starts on that property.
  const [params] = useSearchParams();
  const [filters, setFilters] = useState(() => {
    const kept = loadFilters(orgId);
    const property = params.get('property');
    return property ? { ...kept, search: property } : kept;
  });
  useEffect(() => keepFilters(orgId, filters), [orgId, filters]);

  // The whole timeline, and where it opens: just before today, or before a booking's arrival when
  // opened from it ("See it on the Calendar").
  const timeline = useMemo(() => timelineFor(localToday), [localToday]);
  const [startAt] = useState(() => {
    const asked = params.get('from');
    const at = asked && isIsoDate(asked) ? asked : localToday;
    const start = addDays(at, -DAYS_BEFORE_TODAY);
    return start < timeline.first ? timeline.first : start;
  });
  const [view, setView] = useState({ first: startAt, last: addDays(startAt, 20) });
  const onView = useCallback(
    (first: string, last: string) =>
      setView((was) => (was.first === first && was.last === last ? was : { first, last })),
    [],
  );

  // The pieces around the nights in view, fetched as they come near and kept.
  const pieces = useMemo(
    () => piecesFor(timeline, addDays(view.first, -FETCH_AHEAD), addDays(view.last, FETCH_AHEAD)),
    [timeline, view.first, view.last],
  );
  const results = useCalendarPieces(orgId, pieces, filters.free);
  const signature = results
    .map((r) => `${r.dataUpdatedAt}.${r.isPlaceholderData ? 'p' : 'd'}.${r.status}`)
    .join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: the results change identity every render; their signature says when they really changed
  const data = useMemo(() => mergeCalendars(results.flatMap((r) => (r.data ? [r.data] : []))), [signature]);
  // Nights with an answer of their own, not one kept from before a filter changed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: as above
  const loadedRanges = useMemo(
    () =>
      results
        .filter((r): r is typeof r & { data: Calendar } => Boolean(r.data) && !r.isPlaceholderData)
        .map((r) => [r.data.from, r.data.to] as const),
    [signature],
  );
  const loaded = useCallback(
    (night: string) => loadedRanges.some(([from, to]) => night >= from && night <= to),
    [loadedRanges],
  );
  const fetching = results.some((r) => r.isFetching);
  const error = results.find((r) => r.error)?.error ?? null;

  const allRows = useMemo(() => (data ? buildRows(data) : []), [data]);
  const rows = useMemo(() => filterProperties(allRows, filters), [allRows, filters]);
  const choices = useMemo(() => filterChoices(data?.properties ?? []), [data]);
  const today = data?.today ?? localToday;

  const grid = useRef<GridHandle>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [panel, setPanel] = useState<PanelTarget | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const goTo = (night: string) => grid.current?.scrollToNight(addDays(night, -DAYS_BEFORE_TODAY));

  const changeFilters = (next: CalendarFilters) => {
    // Nights chosen among properties that may now be hidden would change ones out of sight.
    setSelection(null);
    // Availability brings the stay on screen, unless all of it is there already.
    if (next.free && next.free !== filters.free) {
      const { from, to } = next.free;
      if (from < view.first || addDays(to, -1) > view.last) goTo(from);
    }
    setFilters(next);
  };

  const onChoose = useCallback((chosen: Selection) => setPanel({ kind: 'change', selection: chosen }), []);
  const onOpenBar = useCallback(
    (target: BarTarget) =>
      setPanel(
        target.kind === 'stay' ? { kind: 'stay', stay: target.stay } : { kind: 'block', block: target.block },
      ),
    [],
  );
  const close = () => {
    setPanel(null);
    setSelection(null);
  };
  const short = nameWidth === NAME_WIDTH_NARROW;
  const cleaning = useCallback(
    (row: CalendarRow) => (
      <CleaningBadge
        row={row}
        orgId={orgId}
        today={today}
        timeZone={timeZone}
        canChange={canClean}
        short={short}
      />
    ),
    [orgId, today, timeZone, canClean, short],
  );

  const free = filters.free;
  const empty = (
    <div className="flex flex-col items-start gap-2">
      <p className="font-semibold tracking-[-0.015em] text-[18px] text-ink">
        {free && data?.properties.length === 0 ? 'Nothing is available for that stay' : 'No property matches'}
      </p>
      <p className="text-[13.5px] leading-relaxed text-slate">
        {free && data?.properties.length === 0
          ? `For ${rangeLabel(free.from, free.to)}, every property has a booking or block on at least one night${free.guests > 1 ? `, or sleeps fewer than ${free.guests}` : ''}. Try other dates.`
          : `None of the ${plural(data?.propertyCount ?? 0, 'property', 'properties')} matches ${
              !filters.search.trim()
                ? 'all of these filters'
                : filtersOn(filters) > 1
                  ? 'the search and the filters'
                  : 'the search'
            }.`}
      </p>
      <Button variant="quiet" className="mt-1" onClick={() => changeFilters(NO_FILTERS)}>
        Clear all filters
      </Button>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Calendar"
        description={
          editable ? (
            <>
              Prices, minimum stays, bookings and blocks for every property.{' '}
              <span className="pointer-coarse:hidden">
                Scroll sideways through the dates. Drag across nights to change them.
              </span>
              <span className="hidden pointer-coarse:inline">
                Swipe through the dates. Tap a night to change it.
              </span>
            </>
          ) : (
            'Prices, minimum stays, bookings and blocks for every property. Your role can look but not change them.'
          )
        }
        action={
          <DateNav
            label={windowLabel(view.first, view.last)}
            loading={fetching && Boolean(data)}
            min={timeline.first}
            max={timeline.last}
            value={view.first}
            onToday={() => goTo(today)}
            onStep={(nights) => grid.current?.scrollByNights(nights)}
            onPick={goTo}
          />
        }
      />

      {data && data.propertyCount > 0 ? (
        <FilterBar
          filters={filters}
          onChange={changeFilters}
          choices={choices}
          shown={rows.length}
          total={data.propertyCount}
          today={today}
        />
      ) : null}

      {message ? (
        <div className="mb-3">
          <Notice tone="done">{message}</Notice>
        </div>
      ) : null}

      <div ref={frame}>
        {error && !data ? (
          <Notice tone="urgent">
            {error instanceof ApiError ? error.message : 'Could not load the calendar.'}
          </Notice>
        ) : !data ? (
          <PageLoading>Loading the calendar</PageLoading>
        ) : data.propertyCount === 0 ? (
          <EmptyState
            title="No properties yet"
            action={
              <Link to="/properties" className="text-[14px] action">
                Go to Properties
              </Link>
            }
          >
            Each property gets a row here once it is added, with its prices, bookings and blocks by night.
          </EmptyState>
        ) : (
          <CalendarGrid
            ref={grid}
            rows={rows}
            nights={timeline.nights}
            today={today}
            loaded={loaded}
            startAt={startAt}
            onView={onView}
            cleaning={cleaning}
            nameWidth={nameWidth}
            cellWidth={CELL_WIDTH}
            currency={currency}
            locale={locale}
            editable={editable}
            selection={selection}
            onSelect={setSelection}
            onChoose={onChoose}
            onOpenBar={onOpenBar}
            search={filters.search}
            onSearch={(search) => changeFilters({ ...filters, search })}
            empty={empty}
            marked={free ? { from: free.from, to: free.to } : null}
            maxHeight={maxHeight}
          />
        )}
      </div>
      {error && data ? (
        <p className="mt-2 text-[13px] text-urgent" role="alert">
          Some dates didn’t load. Scroll a little to try again.
        </p>
      ) : null}

      {panel ? (
        <CalendarPanel
          target={panel}
          orgId={orgId}
          rows={rows}
          today={today}
          currency={currency}
          locale={locale}
          editable={editable}
          canEditBookings={can(entry.role, 'reservations.write')}
          onSelectionChange={(next) => {
            setSelection(next);
            setPanel({ kind: 'change', selection: next });
          }}
          onClose={close}
          onDone={(text) => {
            close();
            setMessage(text);
          }}
        />
      ) : null}
    </>
  );
}
