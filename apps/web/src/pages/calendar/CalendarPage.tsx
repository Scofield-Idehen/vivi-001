import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { addDays, can, nightsBetween, todayIn } from '@v01/shared';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button, EmptyState, Notice, PageHeader } from '../../components/ui.tsx';
import { ApiError, useCalendar, useWorkspace } from '../../lib/api.ts';
import { plural } from '../../lib/format.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { type BarTarget, CalendarGrid } from './CalendarGrid.tsx';
import { CalendarPanel, type PanelTarget } from './CalendarPanel.tsx';
import { FilterBar } from './FilterBar.tsx';
import {
  buildRows,
  type CalendarFilters,
  CELL_WIDTH,
  filterChoices,
  filterProperties,
  filtersOn,
  filtersToKeep,
  NAME_WIDTH,
  NAME_WIDTH_NARROW,
  NO_FILTERS,
  nightsFrom,
  nightsThatFit,
  parseFilters,
  rangeLabel,
  type Selection,
  windowLabel,
} from './model.ts';

/** Nights shown before today, so this morning's departures are on screen. */
const DAYS_BEFORE_TODAY = 2;
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
 * Every property by night (design phase D1): prices, minimum stays, bookings and blocks, with the
 * price limits behind every price. Choosing nights opens a panel to change them; what changes goes
 * to the channels for properties V-01 runs. Filters across the top find properties; the search
 * sits over their names.
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
  const localToday = todayIn(settings?.timeZone ?? 'Europe/London');
  const editable = can(entry.role, 'calendar.write');

  // As many nights as fit across, measured from the space the grid has.
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
  const count = nightsThatFit(width - 2, nameWidth);
  // Whole nights fill the width exactly; a phone scrolls sideways at the usual width.
  const cellWidth = Math.max(CELL_WIDTH, (width - 2 - nameWidth) / count);

  // The grid ends at the bottom of the window and scrolls inside, wherever the filters leave its top.
  const [top, setTop] = useState(260);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const next = Math.round(element.getBoundingClientRect().top + window.scrollY);
    if (next !== top) setTop(next);
  });
  const maxHeight = `max(420px, calc(100dvh - ${top + BOTTOM_SPACE}px))`;

  const [filters, setFilters] = useState(() => loadFilters(orgId));
  useEffect(() => keepFilters(orgId, filters), [orgId, filters]);

  const [start, setStart] = useState<string | null>(null);
  const first = start ?? addDays(localToday, -DAYS_BEFORE_TODAY);
  const last = addDays(first, count - 1);
  const calendar = useCalendar(orgId, first, last, filters.free);
  const data = calendar.data;
  // Drawn from the nights the data covers, so a window still loading never shows half-empty.
  const nights = useMemo(
    () => (data ? nightsFrom(data.from, nightsBetween(data.from, data.to) + 1) : []),
    [data],
  );
  const allRows = useMemo(() => (data ? buildRows(data, nights) : []), [data, nights]);
  const rows = useMemo(() => filterProperties(allRows, filters), [allRows, filters]);
  const choices = useMemo(() => filterChoices(data?.properties ?? []), [data]);
  const today = data?.today ?? localToday;

  const [selection, setSelection] = useState<Selection | null>(null);
  const [panel, setPanel] = useState<PanelTarget | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [message]);

  const changeFilters = (next: CalendarFilters) => {
    // Nights chosen among properties that may now be hidden would change ones out of sight.
    setSelection(null);
    // A free-dates search brings the stay on screen, unless all of it is there already.
    if (next.free && next.free !== filters.free) {
      const { from, to } = next.free;
      if (from < first || addDays(to, -1) > last) {
        setStart(from <= localToday ? null : addDays(from, -DAYS_BEFORE_TODAY));
      }
    }
    setFilters(next);
  };

  const step = Math.max(7, count - 7);
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

  const navigation = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-2">
        <Button onClick={() => setStart(null)} disabled={start === null}>
          Today
        </Button>
        <div className="flex">
          <button
            type="button"
            aria-label="Earlier nights"
            onClick={() => setStart(addDays(first, -step))}
            className="grid size-9 place-items-center rounded-l-md border border-hairline text-ink transition-colors hover:bg-linen"
          >
            <IconChevronLeft size={18} stroke={1.75} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Later nights"
            onClick={() => setStart(addDays(first, step))}
            className="grid size-9 place-items-center rounded-r-md border border-l-0 border-hairline text-ink transition-colors hover:bg-linen"
          >
            <IconChevronRight size={18} stroke={1.75} aria-hidden />
          </button>
        </div>
      </div>
      <h2 className="text-[15px] font-medium text-ink" aria-live="polite">
        {windowLabel(first, last)}
        {calendar.isFetching && data ? (
          <span className="ml-3 text-[13px] font-normal text-mist">Loading</span>
        ) : null}
      </h2>
    </div>
  );

  const free = filters.free;
  const empty = (
    <div className="flex flex-col items-start gap-2">
      <p className="font-serif text-[19px] text-ink">
        {free && data?.properties.length === 0 ? 'Nothing is free for that stay' : 'No property matches'}
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
                Drag across nights to change them, and down to take in more properties.
              </span>
              <span className="hidden pointer-coarse:inline">Tap a night to change it.</span>
            </>
          ) : (
            'Prices, minimum stays, bookings and blocks for every property. Your role can look but not change them.'
          )
        }
        action={navigation}
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
        {calendar.error ? (
          <Notice tone="urgent">
            {calendar.error instanceof ApiError ? calendar.error.message : 'Could not load the calendar.'}
          </Notice>
        ) : !data ? (
          <p className="text-[14px] text-mist">Loading the calendar</p>
        ) : data.propertyCount === 0 ? (
          <EmptyState
            title="No properties yet"
            action={
              <Link to="/properties" className="text-[14px] text-accent underline-offset-4 hover:underline">
                Go to Properties
              </Link>
            }
          >
            Each property gets a row here once it is added, with its prices, bookings and blocks by night.
          </EmptyState>
        ) : (
          <CalendarGrid
            rows={rows}
            nights={nights}
            today={today}
            nameWidth={nameWidth}
            cellWidth={cellWidth}
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

      {panel ? (
        <CalendarPanel
          target={panel}
          orgId={orgId}
          rows={rows}
          today={today}
          currency={currency}
          locale={locale}
          editable={editable}
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
