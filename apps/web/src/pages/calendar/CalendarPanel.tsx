import { IconX } from '@tabler/icons-react';
import {
  addDays,
  CALENDAR_DAYS_AHEAD,
  type CalendarBlock,
  type CalendarProperty,
  type CalendarStay,
  CHANNEL_LABELS,
  nightsBetween,
} from '@v01/shared';
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Stepper } from '../../components/choices.tsx';
import { MoneyField, TextField } from '../../components/fields.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import { ApiError, useChangeCalendar } from '../../lib/api.ts';
import { plural } from '../../lib/format.ts';
import {
  ALL_DAYS,
  type CalendarRow,
  type ChangeForm,
  hasChanges,
  money,
  newForm,
  priceRange,
  propertyNames,
  rangeLabel,
  resultMessage,
  type Selection,
  shortNight,
  summarise,
  toChange,
} from './model.ts';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

export type PanelTarget =
  | { kind: 'change'; selection: Selection }
  | { kind: 'stay'; stay: CalendarStay }
  | { kind: 'block'; block: CalendarBlock };

interface PanelProps {
  target: PanelTarget;
  orgId: string;
  rows: CalendarRow[];
  today: string;
  currency: string;
  locale: string;
  editable: boolean;
  onSelectionChange(selection: Selection): void;
  onClose(): void;
  /** Saved: the line to show on the calendar. */
  onDone(message: string): void;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const BLOCK_REASONS = ['Owner staying', 'Maintenance', 'Deep clean'];

/** A choice of a few, shown side by side. Real radio buttons underneath, so keyboards work as usual. */
function Segmented<V extends string>({
  legend,
  value,
  options,
  onChange,
  disabled,
  children,
}: {
  legend: string;
  value: V;
  options: readonly { value: V; label: string }[];
  onChange(value: V): void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-2 disabled:opacity-60">
      <legend className="mb-2 text-[13px] text-slate">{legend}</legend>
      <div className="flex w-full rounded-lg bg-linen/80 p-[3px]">
        {options.map((o) => (
          <label
            key={o.value}
            className={cx(
              'flex-1 cursor-pointer rounded-md px-2 py-1.5 text-center text-[13px] transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
              o.value === value
                ? 'bg-canvas font-medium text-ink shadow-[0_1px_2px_rgb(21_24_27/0.12)]'
                : 'text-slate hover:text-ink',
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={o.value === value}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        ))}
      </div>
      {children}
    </fieldset>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-[12.5px] leading-snug text-mist">{children}</p>;
}

/** The usual price in words: "£165 a night, £195 on Fridays and Saturdays". */
function usualPrice(p: CalendarProperty, currency: string, locale: string): string {
  if (!p.basePriceMinor) return 'no usual price yet';
  const base = `${money(p.basePriceMinor, currency, locale)} a night`;
  return p.weekendPriceMinor
    ? `${base}, ${money(p.weekendPriceMinor, currency, locale)} on Fridays and Saturdays`
    : base;
}

/** Properties whose channels V-01 doesn't run yet: their changes stay in V-01 for now. */
function notSentLine(properties: CalendarProperty[]): string {
  const [only] = properties;
  if (properties.length === 1 && only) {
    return only.managedBy === 'guesty'
      ? `${only.name} is still on Guesty, so these changes stay in V-01 and aren't sent to its channels.`
      : `${only.name} isn't connected to its channels yet, so these changes stay in V-01 for now.`;
  }
  return `${propertyNames(properties)} aren't run through V-01 yet, so their changes stay here and aren't sent to the channels.`;
}

function limits(p: CalendarProperty, currency: string, locale: string): string | null {
  const fmt = (minor: number) => money(minor, currency, locale);
  if (p.minPriceMinor && p.maxPriceMinor)
    return `between ${fmt(p.minPriceMinor)} and ${fmt(p.maxPriceMinor)}`;
  if (p.minPriceMinor) return `at least ${fmt(p.minPriceMinor)}`;
  if (p.maxPriceMinor) return `at most ${fmt(p.maxPriceMinor)}`;
  return null;
}

function ChangeBody({
  selection,
  orgId,
  rows,
  today,
  currency,
  locale,
  onSelectionChange,
  onCancel,
  onDone,
}: Omit<PanelProps, 'target' | 'editable' | 'onClose'> & { selection: Selection; onCancel(): void }) {
  const summary = useMemo(() => summarise(selection, rows), [selection, rows]);
  const [form, setForm] = useState<ChangeForm>(() => newForm(summary));
  const [tried, setTried] = useState(false);
  const save = useChangeCalendar(orgId);
  const firstId = useId();
  const lastId = useId();
  const symbol = useMemo(
    () =>
      new Intl.NumberFormat(locale, { style: 'currency', currency })
        .formatToParts(0)
        .find((part) => part.type === 'currency')?.value ?? currency,
    [currency, locale],
  );

  const set = <K extends keyof ChangeForm>(key: K, value: ChangeForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const { change, errors } = toChange(form, selection, currency);
  const one = summary.properties.length === 1 ? summary.properties[0] : null;
  const allPricedElsewhere = summary.pricedByPriceLabs.length === summary.properties.length;
  const nights = summary.nights;

  const submit = () => {
    setTried(true);
    if (!change) return;
    save.mutate(change, { onSuccess: (result) => onDone(resultMessage(result)) });
  };

  const now: string[] = [];
  if (summary.prices) {
    now.push(`${priceRange(summary.prices, currency, locale)} a night`);
  }
  if (summary.minNights) {
    const { low, high } = summary.minNights;
    now.push(
      low === high ? `minimum stay ${plural(low, 'night')}` : `minimum stays ${low} to ${high} nights`,
    );
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-5 py-6 md:px-6">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={firstId} className="text-[13px] text-slate">
              First night
            </label>
            <input
              id={firstId}
              type="date"
              value={selection.firstNight}
              min={today}
              max={selection.lastNight}
              onChange={(e) => {
                const value = e.target.value;
                if (value && value >= today && value <= selection.lastNight) {
                  onSelectionChange({ ...selection, firstNight: value });
                }
              }}
              className="h-9 w-full rounded-md border border-edge bg-white px-2.5 text-[14px] text-ink focus:border-accent focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={lastId} className="text-[13px] text-slate">
              Last night
            </label>
            <input
              id={lastId}
              type="date"
              value={selection.lastNight}
              min={selection.firstNight}
              max={addDays(today, CALENDAR_DAYS_AHEAD)}
              onChange={(e) => {
                const value = e.target.value;
                if (
                  value &&
                  value >= selection.firstNight &&
                  nightsBetween(selection.firstNight, value) < 366
                ) {
                  onSelectionChange({ ...selection, lastNight: value });
                }
              }}
              className="h-9 w-full rounded-md border border-edge bg-white px-2.5 text-[14px] text-ink focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        {now.length || summary.booked || summary.blocked ? (
          <div className="rounded-xl bg-paper px-4 py-3.5 text-[13.5px] leading-relaxed text-slate">
            {now.length ? <p>Now: {now.join(', ')}.</p> : null}
            {summary.booked ? (
              <p>
                {summary.booked === 1 ? '1 night is' : `${summary.booked} nights are`} booked. Bookings stay
                as they are.
              </p>
            ) : null}
            {summary.blocked ? (
              <p>{summary.blocked === 1 ? '1 night is' : `${summary.blocked} nights are`} blocked.</p>
            ) : null}
          </div>
        ) : null}

        {summary.notSent.length ? <Notice>{notSentLine(summary.notSent)}</Notice> : null}

        <Segmented
          legend="Price a night"
          value={form.price}
          onChange={(v) => set('price', v)}
          disabled={allPricedElsewhere}
          options={[
            { value: 'keep', label: 'As it is' },
            { value: 'set', label: 'Set a price' },
            { value: 'usual', label: 'Usual price' },
          ]}
        >
          {allPricedElsewhere ? (
            <Hint>PriceLabs sets the prices here. Change them in PriceLabs.</Hint>
          ) : summary.pricedByPriceLabs.length ? (
            <Hint>
              PriceLabs sets the prices for {propertyNames(summary.pricedByPriceLabs)}. Leave the price as it
              is, or choose only properties whose prices are set here.
            </Hint>
          ) : null}
          {form.price === 'set' && !allPricedElsewhere ? (
            <MoneyField
              label="Price"
              symbol={symbol}
              value={form.priceText}
              onChange={(v) => set('priceText', v)}
              error={tried ? errors.price : undefined}
              hint={
                one && limits(one, currency, locale)
                  ? `For ${one.name}, ${limits(one, currency, locale)}.`
                  : summary.properties.length > 1
                    ? "Each property's lowest and highest prices still apply."
                    : undefined
              }
            />
          ) : null}
          {form.price === 'usual' && !allPricedElsewhere ? (
            <Hint>
              {one
                ? `Back to ${usualPrice(one, currency, locale)}.`
                : 'Each property goes back to its own usual price.'}
            </Hint>
          ) : null}
        </Segmented>

        <Segmented
          legend="Minimum stay"
          value={form.minStay}
          onChange={(v) => set('minStay', v)}
          options={[
            { value: 'keep', label: 'As it is' },
            { value: 'set', label: 'Set' },
            { value: 'usual', label: 'Usual' },
          ]}
        >
          {form.minStay === 'set' ? (
            <Stepper
              label="Nights"
              hint="For guests arriving on these nights"
              value={form.minNights}
              min={1}
              max={60}
              onChange={(v) => set('minNights', v)}
            />
          ) : null}
          {form.minStay === 'usual' ? (
            <Hint>
              {one
                ? `Back to ${plural(one.minNights, 'night')}.`
                : 'Each property goes back to its own usual minimum.'}
            </Hint>
          ) : null}
        </Segmented>

        <div className="grid gap-5 sm:grid-cols-2">
          <Segmented
            legend="Arrivals"
            value={form.arrivals}
            onChange={(v) => set('arrivals', v)}
            options={[
              { value: 'keep', label: 'As is' },
              { value: 'allowed', label: 'Allowed' },
              { value: 'closed', label: 'Closed' },
            ]}
          />
          <Segmented
            legend="Departures"
            value={form.departures}
            onChange={(v) => set('departures', v)}
            options={[
              { value: 'keep', label: 'As is' },
              { value: 'allowed', label: 'Allowed' },
              { value: 'closed', label: 'Closed' },
            ]}
          />
        </div>

        <Segmented
          legend="Availability"
          value={form.availability}
          onChange={(v) => set('availability', v)}
          options={[
            { value: 'keep', label: 'As it is' },
            { value: 'block', label: 'Block' },
            { value: 'open', label: 'Open' },
          ]}
        >
          {form.availability === 'block' ? (
            <>
              <Hint>Free nights are blocked. Booked nights stay as they are.</Hint>
              <div className="flex flex-wrap gap-2">
                {BLOCK_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    aria-pressed={form.blockReason === reason}
                    onClick={() => set('blockReason', reason)}
                    className={cx(
                      'h-8 rounded-full border px-3 text-[13px] transition-colors',
                      form.blockReason === reason
                        ? 'border-accent bg-accent-tint font-medium text-accent'
                        : 'border-hairline text-slate hover:border-edge hover:text-ink',
                    )}
                  >
                    {reason}
                  </button>
                ))}
              </div>
              <TextField
                label="Reason"
                value={form.blockReason}
                onChange={(v) => set('blockReason', v)}
                max={200}
                hint="Shown on the calendar. Guests never see it."
              />
            </>
          ) : null}
          {form.availability === 'open' ? (
            <Hint>Blocked nights open again. Bookings stay as they are.</Hint>
          ) : null}
        </Segmented>

        {nights > 1 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] text-slate">On these days</legend>
            <div className="grid grid-cols-7 gap-1.5">
              {ALL_DAYS.map((day) => {
                const on = form.days.includes(day);
                return (
                  <label
                    key={day}
                    className={cx(
                      'cursor-pointer rounded-md border py-1.5 text-center text-[12.5px] transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent',
                      on
                        ? 'border-accent bg-accent-tint font-medium text-accent'
                        : 'border-hairline text-mist hover:border-edge',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        set('days', on ? form.days.filter((d) => d !== day) : [...form.days, day].sort())
                      }
                      className="sr-only"
                    />
                    {DAY_NAMES[day - 1]}
                  </label>
                );
              })}
            </div>
            {tried && errors.days ? (
              <p className="text-[12.5px] text-urgent">{errors.days}</p>
            ) : (
              <Hint>Untick a day to leave it out.</Hint>
            )}
          </fieldset>
        ) : null}
      </div>

      <footer className="flex flex-col gap-3 border-t border-hairline px-5 py-4 md:px-6">
        {save.error ? (
          <Notice tone="urgent">
            {save.error instanceof ApiError ? save.error.message : 'The change was not saved. Try again.'}
          </Notice>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <Button variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!hasChanges(form) || save.isPending}>
            {save.isPending ? 'Saving' : `Save ${plural(nights * summary.properties.length, 'night')}`}
          </Button>
        </div>
      </footer>
    </>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-hairline py-3 text-[14px]">
      <dt className="text-slate">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

function StayBody({ stay, property }: { stay: CalendarStay; property: CalendarProperty | null }) {
  const nights = nightsBetween(stay.checkIn, stay.checkOut);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-6 md:px-6">
      {stay.status === 'conflict' ? (
        <Notice tone="urgent">
          This booking came in over another one, so it holds no nights. Sort it out with the guest and the
          channel, then cancel one of them there.
        </Notice>
      ) : null}
      <dl>
        {property ? <Fact label="Property">{property.name}</Fact> : null}
        <Fact label="Arrives">{shortNight(stay.checkIn)}</Fact>
        <Fact label="Leaves">{shortNight(stay.checkOut)}</Fact>
        <Fact label="Nights">{nights}</Fact>
        <Fact label="Guests">{stay.guests}</Fact>
        <Fact label="Booked on">{CHANNEL_LABELS[stay.channel]}</Fact>
        {stay.channelReference ? (
          <Fact label="Reference">
            <span className="font-mono text-[13px]">{stay.channelReference}</span>
          </Fact>
        ) : null}
      </dl>
    </div>
  );
}

function BlockBody({
  block,
  property,
  orgId,
  today,
  editable,
  onDone,
}: {
  block: CalendarBlock;
  property: CalendarProperty | null;
  orgId: string;
  today: string;
  editable: boolean;
  onDone(message: string): void;
}) {
  const reopen = useChangeCalendar(orgId);
  const lastNight = addDays(block.endsOn, -1);
  const firstOpenable = block.startsOn < today ? today : block.startsOn;
  const canReopen = editable && lastNight >= today;
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-6 md:px-6">
        <dl>
          {property ? <Fact label="Property">{property.name}</Fact> : null}
          <Fact label="Nights">{rangeLabel(block.startsOn, lastNight)}</Fact>
          <Fact label="Reason">{block.reason ?? 'None given'}</Fact>
        </dl>
        <Hint>Blocked nights are closed on every channel.</Hint>
      </div>
      {canReopen ? (
        <footer className="flex flex-col gap-3 border-t border-hairline px-5 py-4 md:px-6">
          {reopen.error ? (
            <Notice tone="urgent">
              {reopen.error instanceof ApiError
                ? reopen.error.message
                : 'The nights were not opened. Try again.'}
            </Notice>
          ) : null}
          <div className="flex justify-end">
            <Button
              variant="primary"
              disabled={reopen.isPending}
              onClick={() =>
                reopen.mutate(
                  { propertyIds: [block.propertyId], firstNight: firstOpenable, lastNight, blocked: false },
                  { onSuccess: (result) => onDone(resultMessage(result)) },
                )
              }
            >
              {reopen.isPending ? 'Opening' : 'Open these nights'}
            </Button>
          </div>
        </footer>
      ) : null}
    </>
  );
}

/**
 * Slides in from the right, over the calendar. Changes the chosen nights, or shows one booking or
 * block. Escape, Close or a click beside it closes it.
 */
export function CalendarPanel(props: PanelProps) {
  const { target, rows, onClose } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const propertyOf = (id: string) => rows.find((r) => r.property.id === id)?.property ?? null;
  let title: string;
  let subtitle: string;
  if (target.kind === 'change') {
    const s = target.selection;
    const count = nightsBetween(s.firstNight, s.lastNight) + 1;
    title = count === 1 ? shortNight(s.firstNight) : `${rangeLabel(s.firstNight, s.lastNight)}`;
    const chosen = rows.filter((r) => s.propertyIds.includes(r.property.id)).map((r) => r.property);
    subtitle = `${plural(count, 'night')}, ${propertyNames(chosen)}`;
  } else if (target.kind === 'stay') {
    title = target.stay.guestName ?? 'Guest';
    subtitle = `${plural(nightsBetween(target.stay.checkIn, target.stay.checkOut), 'night')}, ${rangeLabel(target.stay.checkIn, target.stay.checkOut)}`;
  } else {
    title = target.block.reason ?? 'Blocked';
    subtitle = `${plural(nightsBetween(target.block.startsOn, target.block.endsOn), 'night')} blocked`;
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the panel through onCancel; this only catches clicks on the dimmed page beside it
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      className="sheet fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-none border-l border-hairline bg-canvas p-0 text-ink md:w-[460px]"
    >
      <div className="flex h-full flex-col pt-[env(safe-area-inset-top,0px)]">
        <header className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4 md:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="font-serif text-[22px] leading-tight text-ink">
              {title}
            </h2>
            <p className="mt-1 text-[13px] text-slate">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-hairline px-3 text-[13.5px] text-ink transition-colors hover:bg-linen"
          >
            <IconX size={16} stroke={1.75} aria-hidden />
            Close
          </button>
        </header>
        {target.kind === 'change' ? (
          <ChangeBody {...props} selection={target.selection} onCancel={onClose} />
        ) : target.kind === 'stay' ? (
          <StayBody stay={target.stay} property={propertyOf(target.stay.propertyId)} />
        ) : (
          <BlockBody
            block={target.block}
            property={propertyOf(target.block.propertyId)}
            orgId={props.orgId}
            today={props.today}
            editable={props.editable}
            onDone={props.onDone}
          />
        )}
      </div>
    </dialog>
  );
}
