import { IconCalendarSearch, IconCheck } from '@tabler/icons-react';
import {
  addDays,
  CLEANING_STATUS_LABELS,
  type CleaningStatus,
  MANAGED_BY_LABELS,
  type ManagedBy,
} from '@v01/shared';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Stepper } from '../../components/choices.tsx';
import { Popover } from '../../components/Popover.tsx';
import { Button, Field } from '../../components/ui.tsx';
import { plural } from '../../lib/format.ts';
import { CalendarKey } from './CalendarKey.tsx';
import {
  BEDROOM_CHOICES,
  type CalendarFilters,
  chosenLabel,
  type FilterChoice,
  type FreeDates,
  filtersOn,
  freeDatesError,
  freeLabel,
  NO_FILTERS,
} from './model.ts';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

const rowClass =
  'flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2.5 py-1.5 text-[13.5px] text-ink transition-colors hover:bg-linen has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-accent';

function Box({ checked, round = false }: { checked: boolean; round?: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        'grid size-[18px] shrink-0 place-items-center border',
        round ? 'rounded-full' : 'rounded-[5px]',
        checked ? 'border-ink bg-ink' : 'border-edge bg-canvas',
      )}
    >
      {checked ? (
        round ? (
          <span className="size-[7px] rounded-full bg-canvas" />
        ) : (
          <IconCheck size={13} stroke={2.6} className="text-canvas" />
        )
      ) : null}
    </span>
  );
}

/** Several choices, any of which a property may match, each with how many properties have it. */
function CheckList({
  legend,
  options,
  chosen,
  onChange,
  emptyText,
}: {
  legend: string;
  options: { value: string; label: string; count: number }[];
  chosen: string[];
  onChange(next: string[]): void;
  emptyText: ReactNode;
}) {
  if (options.length === 0) return <p className="p-4 text-[13px] leading-relaxed text-slate">{emptyText}</p>;
  const toggle = (value: string) =>
    onChange(chosen.includes(value) ? chosen.filter((v) => v !== value) : [...chosen, value]);
  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      <div className="max-h-[300px] overflow-y-auto p-1.5">
        {options.map((option) => {
          const checked = chosen.includes(option.value);
          return (
            <label key={option.value} className={rowClass}>
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() => toggle(option.value)}
              />
              <Box checked={checked} />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              <span className="tnum text-[12.5px] text-mist">
                {option.count}
                <span className="sr-only"> {option.count === 1 ? 'property' : 'properties'}</span>
              </span>
            </label>
          );
        })}
      </div>
      {chosen.length ? (
        <div className="border-t border-hairline px-4 py-2.5">
          <Button variant="quiet" className="text-[13px]" onClick={() => onChange([])}>
            Clear {legend.toLowerCase()}
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}

/** Choices once chosen stay in the list, even when no property shown has them any more. */
function withChosen(choices: FilterChoice[], chosen: string[]): FilterChoice[] {
  const missing = chosen.filter((value) => !choices.some((c) => c.value === value));
  return [...choices, ...missing.map((value) => ({ value, count: 0 }))];
}

function BedroomsList({ value, onChange }: { value: number | null; onChange(next: number | null): void }) {
  const options: (number | null)[] = [null, ...BEDROOM_CHOICES];
  return (
    <fieldset className="p-1.5">
      <legend className="sr-only">Bedrooms</legend>
      {options.map((n) => (
        <label key={n ?? 'any'} className={rowClass}>
          <input
            type="radio"
            name="calendar-bedrooms"
            className="sr-only"
            checked={value === n}
            onChange={() => onChange(n)}
          />
          <Box checked={value === n} round />
          {n === null ? 'Any number' : `${n} or more`}
        </label>
      ))}
    </fieldset>
  );
}

function FreeDatesForm({
  value,
  today,
  onApply,
  close,
}: {
  value: FreeDates | null;
  today: string;
  onApply(next: FreeDates | null): void;
  close(): void;
}) {
  const [from, setFrom] = useState(value?.from ?? today);
  const [to, setTo] = useState(value?.to ?? addDays(today, 2));
  const [guests, setGuests] = useState(value?.guests ?? 2);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problem = freeDatesError(from, to, today);
    if (problem) {
      setError(problem);
      return;
    }
    onApply({ from, to, guests });
    close();
  };

  return (
    <form onSubmit={submit} noValidate className="p-4">
      <p className="text-[14px] font-medium text-ink">Available for a stay</p>
      <p className="mt-1 text-[12.5px] leading-snug text-slate">
        Shows only the properties with no booking or block on those nights, and room for everyone.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Field
          label="Arriving"
          type="date"
          value={from}
          min={today}
          onChange={(event) => {
            const next = event.target.value;
            setFrom(next);
            setError(null);
            // A departure no longer after the arrival moves to the morning after.
            if (next && to <= next) setTo(addDays(next, 1));
          }}
        />
        <Field
          label="Leaving"
          type="date"
          value={to}
          min={from ? addDays(from, 1) : today}
          onChange={(event) => {
            setTo(event.target.value);
            setError(null);
          }}
        />
      </div>
      <div className="mt-1 border-b border-hairline">
        <Stepper label="Guests" value={guests} min={1} max={50} onChange={setGuests} />
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-[12.5px] text-urgent">
          {error}
        </p>
      ) : null}
      <div className="mt-4 flex items-center gap-4">
        <Button variant="primary" type="submit">
          Show available properties
        </Button>
        {value ? (
          <Button
            variant="quiet"
            onClick={() => {
              onApply(null);
              close();
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>
    </form>
  );
}

const SYNC_ORDER: ManagedBy[] = ['v01', 'guesty', 'none'];

/**
 * The filters over the calendar: Availability first (properties free for a stay, as Guesty users
 * look for), then area, tags, sync, cleaning and bedrooms, with how many properties are showing
 * and a way to clear them all. The search sits in the grid, over the names.
 */
export function FilterBar({
  filters,
  onChange,
  choices,
  shown,
  total,
  today,
}: {
  filters: CalendarFilters;
  onChange(next: CalendarFilters): void;
  choices: {
    areas: FilterChoice[];
    tags: FilterChoice[];
    statuses: FilterChoice[];
    cleaning: FilterChoice[];
  };
  /** Properties on screen, and in the workspace. */
  shown: number;
  total: number;
  today: string;
}) {
  const set = (patch: Partial<CalendarFilters>) => onChange({ ...filters, ...patch });
  const statusCount = (s: ManagedBy) => choices.statuses.find((c) => c.value === s)?.count ?? 0;
  const statuses = SYNC_ORDER.filter((s) => statusCount(s) > 0 || filters.statuses.includes(s));
  const on = filtersOn(filters);

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Popover
        title="Availability"
        label={filters.free ? freeLabel(filters.free) : 'Availability'}
        icon={<IconCalendarSearch size={16} stroke={1.75} aria-hidden className="shrink-0 text-slate" />}
        active={filters.free !== null}
        panelClassName="w-[320px]"
      >
        {(close) => (
          <FreeDatesForm value={filters.free} today={today} onApply={(free) => set({ free })} close={close} />
        )}
      </Popover>
      <span aria-hidden className="mx-1 h-6 w-px bg-hairline" />
      <Popover
        title="Area"
        label={filters.areas.length ? chosenLabel(filters.areas, 'areas') : 'Area'}
        active={filters.areas.length > 0}
      >
        <CheckList
          legend="Area"
          options={withChosen(choices.areas, filters.areas).map((c) => ({ ...c, label: c.value }))}
          chosen={filters.areas}
          onChange={(areas) => set({ areas })}
          emptyText="No property has an area or town yet. Add one under Address on the property’s page."
        />
      </Popover>
      <Popover
        title="Tags"
        label={filters.tags.length ? chosenLabel(filters.tags, 'tags') : 'Tags'}
        active={filters.tags.length > 0}
      >
        <CheckList
          legend="Tags"
          options={withChosen(choices.tags, filters.tags).map((c) => ({ ...c, label: c.value }))}
          chosen={filters.tags}
          onChange={(tags) => set({ tags })}
          emptyText="No tags yet. Tags are your team’s own labels, such as an owner or “Sea view”. Add them under the name on a property’s page."
        />
      </Popover>
      <Popover
        title="Sync"
        label={
          filters.statuses.length
            ? chosenLabel(
                filters.statuses.map((s) => MANAGED_BY_LABELS[s]),
                'sync states',
              )
            : 'Sync'
        }
        active={filters.statuses.length > 0}
      >
        <CheckList
          legend="Sync"
          options={statuses.map((s) => ({ value: s, label: MANAGED_BY_LABELS[s], count: statusCount(s) }))}
          chosen={filters.statuses}
          onChange={(next) => set({ statuses: next as ManagedBy[] })}
          emptyText="No properties yet."
        />
      </Popover>
      <Popover
        title="Cleaning"
        label={
          filters.cleaning.length === 1
            ? CLEANING_STATUS_LABELS[filters.cleaning[0] as CleaningStatus]
            : 'Cleaning'
        }
        active={filters.cleaning.length > 0}
        panelClassName="w-[220px]"
      >
        <CheckList
          legend="Cleaning"
          options={choices.cleaning.map((c) => ({
            ...c,
            label: CLEANING_STATUS_LABELS[c.value as CleaningStatus],
          }))}
          chosen={filters.cleaning}
          onChange={(next) => set({ cleaning: next as CleaningStatus[] })}
          emptyText="No properties yet."
        />
      </Popover>
      <Popover
        title="Bedrooms"
        label={filters.minBedrooms ? `${filters.minBedrooms}+ bedrooms` : 'Bedrooms'}
        active={filters.minBedrooms !== null}
        panelClassName="w-[220px]"
      >
        <BedroomsList value={filters.minBedrooms} onChange={(minBedrooms) => set({ minBedrooms })} />
      </Popover>

      <p className="tnum ml-1 text-[13px] text-slate" aria-live="polite">
        {on
          ? `${shown} of ${plural(total, 'property', 'properties')}`
          : plural(total, 'property', 'properties')}
      </p>
      {on ? (
        <Button variant="quiet" className="text-[13px]" onClick={() => onChange(NO_FILTERS)}>
          Clear all
        </Button>
      ) : null}

      <div className="ml-auto">
        <CalendarKey />
      </div>
    </div>
  );
}
