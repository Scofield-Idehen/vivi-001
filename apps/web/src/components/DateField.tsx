import { IconCalendarMonth, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { addDays } from '@v01/shared';
import { useId, useState } from 'react';
import { Popover } from './Popover.tsx';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });
const SHOWN = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const noon = (day: string) => new Date(`${day}T12:00:00`);
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monthOf = (day: string) => day.slice(0, 7);
const firstOf = (month: string) => `${month}-01`;

function shiftMonth(month: string, by: number): string {
  const d = new Date(`${month}-01T12:00:00`);
  d.setMonth(d.getMonth() + by);
  return monthOf(iso(d));
}

/** The weeks of one month, Monday first, with blanks where the month hasn't started or has ended. */
function weeksOf(month: string): (string | null)[][] {
  const first = noon(firstOf(month));
  const lead = (first.getDay() + 6) % 7;
  const days: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = firstOf(month); monthOf(d) === month; d = addDays(d, 1)) days.push(d);
  while (days.length % 7) days.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return weeks;
}

/**
 * A month to pick a day from. `min` greys out earlier days; `rangeFrom` (the other end of a stay)
 * shades the nights between it and the day under the mouse, so check-out reads as a stay.
 */
export function MonthGrid({
  value,
  onPick,
  min,
  max,
  rangeFrom,
  today,
}: {
  value: string | null;
  onPick(day: string): void;
  min?: string;
  max?: string;
  rangeFrom?: string | null;
  today: string;
}) {
  const [month, setMonth] = useState(
    monthOf(value && DAY.test(value) ? value : rangeFrom && DAY.test(rangeFrom) ? rangeFrom : today),
  );
  const [hover, setHover] = useState<string | null>(null);
  // With a stay's start given, the day under the mouse previews the stay that picking it would make.
  const end = rangeFrom && hover && hover > rangeFrom ? hover : value;
  const inRange = (day: string) => Boolean(rangeFrom && end && rangeFrom < day && day < end);
  return (
    <div className="w-[292px] select-none p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setMonth((m) => shiftMonth(m, -1))}
          className="inline-flex size-8 items-center justify-center rounded-lg text-ink hover:bg-linen"
        >
          <IconChevronLeft size={18} stroke={1.75} />
        </button>
        <span className="text-[14px] font-medium text-ink">{MONTH.format(noon(firstOf(month)))}</span>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setMonth((m) => shiftMonth(m, 1))}
          className="inline-flex size-8 items-center justify-center rounded-lg text-ink hover:bg-linen"
        >
          <IconChevronRight size={18} stroke={1.75} />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11.5px] text-mist">
        {WEEKDAYS.map((w, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: two weekdays share a letter
          <span key={i} className="py-1">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-y-0.5">
        {weeksOf(month)
          .flat()
          .map((day, i) =>
            day ? (
              <button
                key={day}
                type="button"
                disabled={(min !== undefined && day < min) || (max !== undefined && day > max)}
                onClick={() => onPick(day)}
                onMouseEnter={() => setHover(day)}
                onMouseLeave={() => setHover((h) => (h === day ? null : h))}
                aria-label={SHOWN.format(noon(day))}
                aria-pressed={day === value}
                className={cx(
                  'relative h-9 text-[13.5px] tnum transition-colors disabled:cursor-not-allowed',
                  day !== rangeFrom && 'disabled:text-mist/50',
                  day === end || day === rangeFrom
                    ? 'z-10 rounded-lg bg-ink font-medium text-canvas'
                    : inRange(day)
                      ? 'bg-accent-tint text-ink'
                      : 'rounded-lg text-ink hover:bg-linen',
                  day === rangeFrom && end && end > rangeFrom && 'rounded-r-none',
                  day === end && rangeFrom && 'rounded-l-none',
                  // Today carries a small dot under its number.
                  day === today &&
                    day !== end &&
                    day !== rangeFrom &&
                    'font-medium after:absolute after:bottom-1 after:left-1/2 after:size-1 after:-translate-x-1/2 after:rounded-full after:bg-accent',
                )}
              >
                {Number(day.slice(8))}
              </button>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: blanks have nothing else to be keyed by
              <span key={`blank-${i}`} />
            ),
          )}
      </div>
      <div className="mt-2 flex justify-between text-[12.5px]">
        <button type="button" onClick={() => setMonth(monthOf(today))} className="action -ml-2.5 !h-8">
          Today
        </button>
        {min ? <span className="self-center text-mist">From {SHOWN.format(noon(min))}</span> : null}
      </div>
    </div>
  );
}

/**
 * A date, picked from a calendar that opens under the field. The value is an ISO day; the field
 * shows it the way people read it. For a stay, give the check-out field the check-in as `rangeFrom`
 * and `min` the day after it.
 */
export function DateField({
  label,
  value,
  onChange,
  min,
  max,
  rangeFrom,
  today,
  hint,
  error,
}: {
  label: string;
  value: string;
  onChange(day: string): void;
  min?: string;
  max?: string;
  rangeFrom?: string | null;
  today: string;
  hint?: React.ReactNode;
  error?: string;
}) {
  const id = useId();
  const valid = DAY.test(value);
  return (
    <div className="flex flex-col gap-1.5">
      <span id={id} className="text-[13px] text-slate">
        {label}
      </span>
      <div className="*:w-full">
        <Popover
          title={label}
          buttonLabel={`${label}: ${valid ? SHOWN.format(noon(value)) : 'choose a date'}`}
          label={
            <>
              <IconCalendarMonth size={16} stroke={1.75} aria-hidden className="shrink-0 text-slate" />
              <span className={cx('truncate', valid ? 'text-ink' : 'text-mist')}>
                {valid ? SHOWN.format(noon(value)) : 'Choose a date'}
              </span>
            </>
          }
          buttonClassName={cx(
            'inline-flex h-9 w-full items-center gap-2 rounded-md border bg-white px-3 text-left text-[14px] focus:border-accent focus:outline-none',
            error ? 'border-urgent' : 'border-edge',
          )}
          panelClassName="w-auto"
        >
          {(close) => (
            <MonthGrid
              value={valid ? value : null}
              min={min}
              max={max}
              rangeFrom={rangeFrom}
              today={today}
              onPick={(day) => {
                onChange(day);
                close();
              }}
            />
          )}
        </Popover>
      </div>
      {error ? (
        <p className="text-[12.5px] text-urgent">{error}</p>
      ) : hint ? (
        <p className="text-[12.5px] text-mist">{hint}</p>
      ) : null}
    </div>
  );
}
