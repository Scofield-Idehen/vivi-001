import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { addDays, can, nightsBetween, todayIn } from '@v01/shared';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button, EmptyState, Notice, PageHeader } from '../../components/ui.tsx';
import { ApiError, useCalendar, useWorkspace } from '../../lib/api.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { type BarTarget, CalendarGrid } from './CalendarGrid.tsx';
import { CalendarPanel, type PanelTarget } from './CalendarPanel.tsx';
import {
  buildRows,
  CELL_WIDTH,
  NAME_WIDTH,
  NAME_WIDTH_NARROW,
  nightsFrom,
  nightsThatFit,
  type Selection,
  windowLabel,
} from './model.ts';

/** Nights shown before today, so this morning's departures are on screen. */
const DAYS_BEFORE_TODAY = 2;

function Key({ swatch, children }: { swatch: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      {swatch}
      {children}
    </span>
  );
}

/** What the marks on the calendar mean, in words. */
function Legend() {
  return (
    <p className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px] text-slate">
      <Key swatch={<span aria-hidden className="h-3 w-6 rounded-full bg-accent" />}>Booked</Key>
      <Key
        swatch={
          <span
            aria-hidden
            className="h-3 w-6 rounded-sm border border-edge/45 bg-[repeating-linear-gradient(135deg,var(--color-linen)_0_3px,var(--color-paper)_3px_6px)]"
          />
        }
      >
        Blocked
      </Key>
      <Key swatch={<span aria-hidden className="h-3 w-6 rounded-full border border-urgent" />}>
        Overlapping booking
      </Key>
      <Key swatch={<span className="tnum font-semibold text-accent">£180</span>}>Set for that night</Key>
      <Key swatch={<span className="tnum text-pending-text">£95</span>}>Held at a price limit</Key>
      <Key swatch={<span aria-hidden className="size-[6px] rounded-full bg-plum" />}>
        Arrivals or departures closed
      </Key>
    </p>
  );
}

/**
 * Every property by night (design phase D1): prices, minimum stays, bookings and blocks, with the
 * price limits behind every price. Choosing nights opens a panel to change them; what changes goes
 * to the channels for properties V-01 runs.
 */
export function CalendarPage() {
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

  const [start, setStart] = useState<string | null>(null);
  const first = start ?? addDays(localToday, -DAYS_BEFORE_TODAY);
  const last = addDays(first, count - 1);
  const calendar = useCalendar(orgId, first, last);
  const data = calendar.data;
  // Drawn from the nights the data covers, so a window still loading never shows half-empty.
  const nights = useMemo(
    () => (data ? nightsFrom(data.from, nightsBetween(data.from, data.to) + 1) : []),
    [data],
  );
  const rows = useMemo(() => (data ? buildRows(data, nights) : []), [data, nights]);
  const today = data?.today ?? localToday;

  const [selection, setSelection] = useState<Selection | null>(null);
  const [panel, setPanel] = useState<PanelTarget | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [message]);

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

      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <h2 className="text-[15px] font-medium text-ink" aria-live="polite">
          {windowLabel(first, last)}
          {calendar.isFetching && data ? (
            <span className="ml-3 text-[13px] font-normal text-mist">Loading</span>
          ) : null}
        </h2>
        <Legend />
      </div>

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
        ) : rows.length === 0 ? (
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
