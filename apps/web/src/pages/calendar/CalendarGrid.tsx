import { IconHome } from '@tabler/icons-react';
import {
  type CalendarBlock,
  type CalendarProperty,
  type CalendarStay,
  isWeekendNight,
  MANAGED_BY_LABELS,
} from '@v01/shared';
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router';
import {
  type Bar,
  barFor,
  type CalendarRow,
  dayOfMonth,
  type GridPoint,
  isSelected,
  longNight,
  money,
  monthSpans,
  type NightCell,
  ROW_HEIGHT,
  type Selection,
  selectionBetween,
  weekdayOf,
} from './model.ts';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

const MONTHS_HEIGHT = 26;
const DAYS_HEIGHT = 46;
export const HEADER_HEIGHT = MONTHS_HEIGHT + DAYS_HEIGHT;
/** Rows drawn above and below the ones in view, so scrolling never shows a gap. */
const OVERSCAN = 6;

export type BarTarget = { kind: 'stay'; stay: CalendarStay } | { kind: 'block'; block: CalendarBlock };

interface GridProps {
  rows: CalendarRow[];
  nights: string[];
  today: string;
  nameWidth: number;
  /** A night's width: the usual one, or wider when that fills the space exactly. */
  cellWidth: number;
  currency: string;
  locale: string;
  /** False for roles that can only look. */
  editable: boolean;
  selection: Selection | null;
  onSelect(selection: Selection | null): void;
  /** A finished selection: open the panel to change it. */
  onChoose(selection: Selection): void;
  onOpenBar(target: BarTarget): void;
}

/** What a cell says to a screen reader: everything the eye gets from it. */
function describeCell(property: CalendarProperty, cell: NightCell, currency: string, locale: string): string {
  const { rules } = cell;
  const parts = [
    `${property.name}, ${longNight(cell.night)}`,
    rules.priceMinor === null ? 'no price set' : `${money(rules.priceMinor, currency, locale)} a night`,
    `minimum stay ${rules.minNights} ${rules.minNights === 1 ? 'night' : 'nights'}`,
  ];
  if (cell.own) parts.push('set for this night');
  if (rules.heldAt) parts.push(`held at the ${rules.heldAt} price`);
  if (rules.closedToArrival) parts.push('no arrivals');
  if (rules.closedToDeparture) parts.push('no departures');
  if (cell.booked) parts.push('booked');
  if (cell.blocked) parts.push('blocked');
  if (cell.past) parts.push('passed');
  return parts.join(', ');
}

function Thumbnail({ property }: { property: CalendarProperty }) {
  return property.coverPhotoUrl ? (
    <img
      src={property.coverPhotoUrl}
      alt=""
      loading="lazy"
      className="h-[33px] w-[44px] shrink-0 rounded-md object-cover"
    />
  ) : (
    <span aria-hidden className="grid h-[33px] w-[44px] shrink-0 place-items-center rounded-md bg-linen">
      <IconHome size={17} stroke={1.3} className="text-edge" />
    </span>
  );
}

interface Laid<T> {
  item: T;
  bar: Bar;
  lane: number;
  /** Lanes in this bar's group of overlapping bars: 1 unless something overlaps it. */
  lanes: number;
}

/**
 * Bars that overlap (a clashing booking over another) share the row in lanes, so both stay
 * readable; every other bar keeps the full height.
 */
function lay<T>(items: { item: T; bar: Bar }[]): Laid<T>[] {
  const sorted = [...items].sort((a, b) => a.bar.start - b.bar.start);
  const laid: Laid<T>[] = [];
  let group: Laid<T>[] = [];
  let ends: number[] = [];
  let groupEnd = Number.NEGATIVE_INFINITY;
  const close = () => {
    for (const member of group) member.lanes = ends.length;
    group = [];
    ends = [];
  };
  for (const { item, bar } of sorted) {
    if (bar.start >= groupEnd - 0.01) {
      close();
      groupEnd = Number.NEGATIVE_INFINITY;
    }
    let lane = ends.findIndex((end) => end <= bar.start + 0.01);
    if (lane === -1) lane = ends.length;
    ends[lane] = bar.start + bar.length;
    groupEnd = Math.max(groupEnd, bar.start + bar.length);
    const placed = { item, bar, lane, lanes: 1 };
    group.push(placed);
    laid.push(placed);
  }
  close();
  return laid;
}

function guestLabel(stay: CalendarStay): string {
  const who = stay.guestName ?? 'Guest';
  return stay.status === 'conflict' ? `Overlap: ${who}` : who;
}

function Bars({
  row,
  nights,
  nameWidth,
  cellWidth,
  onOpen,
}: {
  row: CalendarRow;
  nights: string[];
  nameWidth: number;
  cellWidth: number;
  onOpen(target: BarTarget): void;
}) {
  const items: { item: BarTarget; bar: Bar }[] = [];
  for (const stay of row.stays) {
    const bar = barFor(stay.checkIn, stay.checkOut, nights);
    if (bar) items.push({ item: { kind: 'stay', stay }, bar });
  }
  for (const block of row.blocks) {
    const bar = barFor(block.startsOn, block.endsOn, nights);
    if (bar) items.push({ item: { kind: 'block', block }, bar });
  }
  // A bar on its own is full height; overlapping ones share the space, thinner.
  const top = 38;
  const space = 28;

  return (
    <>
      {lay(items).map(({ item, bar, lane, lanes }) => {
        const height = lanes === 1 ? 24 : Math.max(8, Math.floor((space - (lanes - 1) * 2) / lanes));
        const style = {
          left: nameWidth + bar.start * cellWidth + 1,
          width: bar.length * cellWidth - 2,
          top: lanes === 1 ? top : top - 2 + lane * (height + 2),
          height,
        };
        const rounding = cx(bar.before ? 'rounded-l-none' : '', bar.after ? 'rounded-r-none' : '');
        const small = lanes > 1 ? 'text-[10.5px]' : 'text-[12px]';
        if (item.kind === 'stay') {
          const { stay } = item;
          const conflict = stay.status === 'conflict';
          return (
            <button
              key={stay.id}
              type="button"
              onClick={() => onOpen(item)}
              style={style}
              className={cx(
                'absolute z-[2] flex items-center overflow-hidden rounded-full px-2.5 text-left font-medium whitespace-nowrap',
                small,
                rounding,
                conflict
                  ? 'border border-urgent bg-[repeating-linear-gradient(135deg,rgb(169_65_47/0.1)_0_5px,var(--color-canvas)_5px_10px)] text-urgent'
                  : 'bg-accent text-canvas shadow-[0_1px_2px_rgb(21_24_27/0.18)] hover:bg-accent/90',
              )}
            >
              <span className="truncate">{guestLabel(stay)}</span>
            </button>
          );
        }
        const { block } = item;
        return (
          <button
            key={block.id}
            type="button"
            onClick={() => onOpen(item)}
            style={style}
            className={cx(
              'absolute z-[2] flex items-center overflow-hidden rounded-md border border-edge/45 bg-[repeating-linear-gradient(135deg,var(--color-linen)_0_5px,var(--color-paper)_5px_10px)] px-2.5 text-left whitespace-nowrap text-slate hover:border-edge',
              small,
              rounding,
            )}
          >
            <span className="truncate">{block.reason ?? 'Blocked'}</span>
          </button>
        );
      })}
    </>
  );
}

function Cell({
  property,
  cell,
  point,
  selected,
  focusable,
  editable,
  currency,
  locale,
  nameWidth,
  cellWidth,
  register,
  onKeyDown,
  onPointerDown,
  onClick,
}: {
  property: CalendarProperty;
  cell: NightCell;
  point: GridPoint;
  selected: boolean;
  focusable: boolean;
  editable: boolean;
  currency: string;
  locale: string;
  nameWidth: number;
  cellWidth: number;
  register(point: GridPoint, element: HTMLElement | null): void;
  onKeyDown(event: KeyboardEvent, point: GridPoint): void;
  onPointerDown(event: PointerEvent, point: GridPoint): void;
  onClick(point: GridPoint): void;
}) {
  const { rules } = cell;
  const held = cell.booked || cell.blocked;
  const weekend = isWeekendNight(cell.night);
  const content = (
    <>
      <span aria-hidden className="flex flex-col items-start gap-0.5 px-1.5 pt-[7px]">
        <span
          className={cx(
            'tnum flex items-center gap-1 text-[12.5px] leading-none',
            cell.past || held ? 'text-edge' : rules.heldAt ? 'text-pending-text' : 'text-ink',
            cell.own && rules.priceMinor !== null && !cell.past && 'font-semibold',
            cell.own && !cell.past && !held && !rules.heldAt && 'text-accent',
          )}
        >
          {rules.priceMinor === null ? '' : money(rules.priceMinor, currency, locale)}
          {rules.closedToArrival || rules.closedToDeparture ? (
            <span className="size-[5px] shrink-0 rounded-full bg-plum" />
          ) : null}
        </span>
        {/* The usual minimum is beside the name; a night only shows its own. */}
        {rules.minNightsFrom === 'night' ? (
          <span
            className={cx(
              'text-[10.5px] leading-none font-medium',
              cell.past || held ? 'text-edge' : 'text-accent',
            )}
          >
            min {rules.minNights}
          </span>
        ) : null}
      </span>
      <span className="sr-only">{describeCell(property, cell, currency, locale)}</span>
    </>
  );
  const className = cx(
    'relative flex h-full shrink-0 flex-col justify-start border-r border-hairline/70 text-left outline-offset-[-2px]',
    weekend && !selected && 'bg-paper/55',
    cell.past && 'bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgb(149_139_123/0.07)_6px_7px)]',
    selected && 'bg-accent-tint shadow-[inset_0_0_0_1px_var(--color-accent)]',
  );
  const style = { width: cellWidth, scrollMarginLeft: nameWidth, scrollMarginTop: HEADER_HEIGHT };

  if (!editable) {
    return (
      <div className={className} style={style}>
        {content}
      </div>
    );
  }
  return (
    <button
      type="button"
      ref={(element) => register(point, element)}
      tabIndex={focusable ? 0 : -1}
      aria-pressed={selected}
      data-row={point.row}
      data-col={point.col}
      onKeyDown={(event) => onKeyDown(event, point)}
      onPointerDown={(event) => onPointerDown(event, point)}
      onClick={() => onClick(point)}
      className={cx(
        className,
        cell.past ? 'cursor-default' : cx('cursor-cell', !selected && 'hover:bg-linen/70'),
      )}
      style={style}
    >
      {content}
    </button>
  );
}

/**
 * Every property by night: prices and minimum stays in the cells, bookings and blocks as bars from
 * arrival to departure. Drag across nights (and down across properties) to choose some; arrows move,
 * Shift and the arrows choose, Enter opens the change. Rows outside the view aren't drawn, so a long
 * portfolio scrolls smoothly.
 */
export function CalendarGrid({
  rows,
  nights,
  today,
  nameWidth,
  cellWidth,
  currency,
  locale,
  editable,
  selection,
  onSelect,
  onChoose,
  onOpenBar,
}: GridProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const cells = useRef(new Map<string, HTMLElement>());
  const anchor = useRef<GridPoint | null>(null);
  const dragging = useRef(false);
  const pointerType = useRef<string>('none');
  const [focus, setFocus] = useState<GridPoint>({ row: 0, col: 0 });
  const [view, setView] = useState({ top: 0, height: 800 });

  const todayCol = Math.max(0, nights.indexOf(today));
  const months = useMemo(() => monthSpans(nights), [nights]);
  const width = nameWidth + nights.length * cellWidth;

  // Keep the focused cell inside the grid when the window or the properties change.
  useEffect(() => {
    setFocus((f) => ({
      row: Math.min(f.row, Math.max(0, rows.length - 1)),
      col: Math.min(Math.max(f.col, todayCol), nights.length - 1),
    }));
  }, [rows.length, nights.length, todayCol]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setView({ top: element.scrollTop, height: element.clientHeight });
    measure();
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    element.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, []);

  const register = useCallback((point: GridPoint, element: HTMLElement | null) => {
    const key = `${point.row}:${point.col}`;
    if (element) cells.current.set(key, element);
    else cells.current.delete(key);
  }, []);

  const select = useCallback(
    (a: GridPoint, b: GridPoint) => {
      const next = selectionBetween(rows, nights, a, b, today);
      onSelect(next);
      return next;
    },
    [rows, nights, today, onSelect],
  );

  // A drag ends wherever the mouse is let go, even outside the grid.
  useEffect(() => {
    const finish = () => {
      if (!dragging.current) return;
      dragging.current = false;
      if (selection) onChoose(selection);
    };
    window.addEventListener('pointerup', finish);
    return () => window.removeEventListener('pointerup', finish);
  }, [selection, onChoose]);

  const pastOrMissing = (point: GridPoint) => {
    const night = nights[point.col];
    return !night || night < today;
  };

  const onPointerDown = (event: PointerEvent, point: GridPoint) => {
    pointerType.current = event.pointerType;
    if (event.pointerType !== 'mouse' || event.button !== 0 || pastOrMissing(point)) return;
    event.preventDefault();
    if (event.shiftKey && anchor.current) {
      select(anchor.current, point);
    } else {
      anchor.current = point;
      select(point, point);
    }
    dragging.current = true;
    setFocus(point);
    cells.current.get(`${point.row}:${point.col}`)?.focus({ preventScroll: true });
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging.current || !anchor.current) return;
    // Bookings and blocks sit over the cells; look underneath them for the night.
    const target = document
      .elementsFromPoint(event.clientX, event.clientY)
      .find((element): element is HTMLElement => element instanceof HTMLElement && 'col' in element.dataset);
    if (!target) return;
    const point = { row: Number(target.dataset.row), col: Number(target.dataset.col) };
    if (point.row === focus.row && point.col === focus.col) return;
    setFocus(point);
    select(anchor.current, point);
  };

  // A tap on a phone or tablet chooses one night; the panel can stretch it to more. A mouse chose
  // already, on the way down and up; a screen reader's click comes with no pointer at all.
  const onClick = (point: GridPoint) => {
    const from = pointerType.current;
    pointerType.current = 'none';
    if (from === 'mouse' || pastOrMissing(point)) return;
    anchor.current = point;
    const chosen = select(point, point);
    if (chosen) onChoose(chosen);
  };

  const moveTo = (point: GridPoint) => {
    const next = {
      row: Math.max(0, Math.min(rows.length - 1, point.row)),
      col: Math.max(0, Math.min(nights.length - 1, point.col)),
    };
    setFocus(next);
    // The row may not be drawn yet; focus it once it is.
    requestAnimationFrame(() => {
      const element = cells.current.get(`${next.row}:${next.col}`);
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return next;
  };

  const onKeyDown = (event: KeyboardEvent, point: GridPoint) => {
    const steps: Record<string, GridPoint> = {
      ArrowRight: { row: point.row, col: point.col + 1 },
      ArrowLeft: { row: point.row, col: point.col - 1 },
      ArrowDown: { row: point.row + 1, col: point.col },
      ArrowUp: { row: point.row - 1, col: point.col },
      Home: { row: point.row, col: todayCol },
      End: { row: point.row, col: nights.length - 1 },
    };
    const step = steps[event.key];
    if (step) {
      event.preventDefault();
      const next = moveTo(step);
      if (event.shiftKey) {
        if (!anchor.current) anchor.current = point;
        select(anchor.current, next);
      } else {
        anchor.current = null;
      }
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (pastOrMissing(point)) return;
      const chosen =
        selection && isSelected(selection, rows[point.row]?.property.id ?? '', nights[point.col] ?? '')
          ? selection
          : select(point, point);
      if (chosen) onChoose(chosen);
      return;
    }
    if (event.key === 'Escape' && selection) {
      event.preventDefault();
      anchor.current = null;
      onSelect(null);
    }
  };

  // Only the rows in view (and a few either side) are drawn; the focused row always is.
  const first = Math.max(0, Math.floor((view.top - HEADER_HEIGHT) / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length - 1, Math.ceil((view.top + view.height) / ROW_HEIGHT) + OVERSCAN);
  const drawn = rows
    .map((row, index) => ({ row, index }))
    .filter(({ index }) => {
      return (index >= first && index <= last) || index === focus.row;
    });

  return (
    <div
      ref={scroller}
      onPointerMove={onPointerMove}
      style={{ '--name-width': `${nameWidth}px` } as CSSProperties}
      className="relative max-h-[calc(100dvh-230px)] overflow-auto overscroll-contain rounded-xl border border-hairline bg-canvas select-none"
    >
      <div style={{ width }} className="relative">
        {/* Months, then days. Sticks to the top as the properties scroll. */}
        <div className="sticky top-0 z-[6] border-b border-hairline bg-canvas">
          <div className="flex" style={{ height: MONTHS_HEIGHT }}>
            <div
              className="sticky left-0 z-[7] shrink-0 border-r border-hairline bg-paper"
              style={{ width: nameWidth }}
            />
            <div className="relative grow">
              {months.map((m) => (
                <span
                  key={m.label}
                  className="absolute top-0 flex h-full items-end border-l border-hairline/70 pb-1 pl-2 text-[12px] font-medium whitespace-nowrap text-slate first:border-l-0"
                  style={{ left: m.start * cellWidth, width: m.length * cellWidth }}
                >
                  <span className="sticky left-[calc(var(--name-width)+8px)]">{m.label}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="flex" style={{ height: DAYS_HEIGHT }}>
            <div
              className="sticky left-0 z-[7] flex shrink-0 items-end border-r border-hairline bg-paper px-4 pb-2 text-[12.5px] text-mist"
              style={{ width: nameWidth }}
            >
              {rows.length === 1 ? '1 property' : `${rows.length} properties`}
            </div>
            {nights.map((night) => {
              const isToday = night === today;
              return (
                <div
                  key={night}
                  className={cx(
                    'flex shrink-0 flex-col items-center justify-center gap-1 border-r border-hairline/70',
                    isWeekendNight(night) && 'bg-paper/55',
                  )}
                  style={{ width: cellWidth }}
                >
                  <span className={cx('text-[11px] leading-none', night < today ? 'text-edge' : 'text-mist')}>
                    {weekdayOf(night)}
                  </span>
                  <span
                    className={cx(
                      'tnum grid size-[22px] place-items-center rounded-full text-[13px] leading-none font-medium',
                      isToday ? 'bg-accent text-canvas' : night < today ? 'text-edge' : 'text-ink',
                    )}
                  >
                    {dayOfMonth(night)}
                  </span>
                  {isToday ? <span className="sr-only">today</span> : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* Space for the rows not drawn, above and below, so the scrollbar stays true. */}
        <div style={{ height: rows.length * ROW_HEIGHT }} className="relative">
          {drawn.map(({ row, index }) => (
            <div
              key={row.property.id}
              className="absolute right-0 left-0 flex border-b border-hairline"
              style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
            >
              <div
                className="sticky left-0 z-[4] flex shrink-0 items-center gap-3 border-r border-hairline bg-paper px-3"
                style={{ width: nameWidth }}
              >
                {nameWidth > 160 ? <Thumbnail property={row.property} /> : null}
                <div className="min-w-0">
                  <Link
                    to={`/properties/${row.property.id}`}
                    className="block truncate font-serif text-[14.5px] leading-tight text-ink underline-offset-4 hover:underline"
                  >
                    {row.property.name}
                  </Link>
                  <p className="mt-0.5 truncate text-[11.5px] leading-snug text-mist">
                    {row.property.managedBy === 'v01'
                      ? row.property.internalCode
                      : MANAGED_BY_LABELS[row.property.managedBy]}
                  </p>
                  <p className="truncate text-[11.5px] leading-snug text-mist">
                    Min {row.property.minNights} {row.property.minNights === 1 ? 'night' : 'nights'}
                  </p>
                </div>
              </div>
              {row.cells.map((cell, col) => (
                <Cell
                  key={cell.night}
                  property={row.property}
                  cell={cell}
                  point={{ row: index, col }}
                  selected={isSelected(selection, row.property.id, cell.night)}
                  focusable={focus.row === index && focus.col === col}
                  editable={editable}
                  currency={currency}
                  locale={locale}
                  nameWidth={nameWidth}
                  cellWidth={cellWidth}
                  register={register}
                  onKeyDown={onKeyDown}
                  onPointerDown={onPointerDown}
                  onClick={onClick}
                />
              ))}
              <Bars
                row={row}
                nights={nights}
                nameWidth={nameWidth}
                cellWidth={cellWidth}
                onOpen={onOpenBar}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
