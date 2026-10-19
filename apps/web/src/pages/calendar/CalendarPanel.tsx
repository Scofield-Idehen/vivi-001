import { IconArrowLeft, IconCheck, IconChevronRight, IconPencil, IconX } from '@tabler/icons-react';
import {
  addDays,
  CALENDAR_DAYS_AHEAD,
  type CalendarBlock,
  type CalendarProperty,
  type CalendarStay,
  formatMoney,
  nightsBetween,
} from '@v01/shared';
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Stepper } from '../../components/choices.tsx';
import { MoneyField, TextField } from '../../components/fields.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import { ApiError, useChangeCalendar, useReservation } from '../../lib/api.ts';
import { plural } from '../../lib/format.ts';
import { contactRoutes, partyLabel, stayTimes } from '../reservations/model.ts';
import { ChannelName, MessageGuest, ReservationEditor, StatusLabel } from '../reservations/parts.tsx';
import {
  ALL_DAYS,
  type CalendarRow,
  type ChangeForm,
  hasChanges,
  money,
  newForm,
  nightsToChange,
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
  /** The role can change a booking's guest details, agreed times and notes. */
  canEditBookings: boolean;
  onSelectionChange(selection: Selection): void;
  onClose(): void;
  /** Saved: the line to show on the calendar. */
  onDone(message: string): void;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const BLOCK_REASONS = ['Owner staying', 'Maintenance', 'Deep clean'];

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

/** What someone can do with the nights they chose, one at a time. */
type Action = 'price' | 'minStay' | 'usual' | 'block' | 'owner' | 'open' | 'arrivals';

const ACTION_TITLES: Record<Action, string> = {
  price: 'Set a price',
  minStay: 'Set a minimum stay',
  usual: 'Back to the usual price and stay',
  block: 'Block the nights',
  owner: 'Owner staying',
  open: 'Open the blocked nights',
  arrivals: 'Close to arrivals or departures',
};

/** One line of the list of actions: what it does, what's there now, and an arrow. */
function ActionRow({
  label,
  detail,
  disabled,
  onClick,
}: {
  label: string;
  detail?: string | null;
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-linen disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent"
      >
        <span className="min-w-0">
          <span className="block text-[14.5px] text-ink">{label}</span>
          {detail ? (
            <span className="mt-0.5 block text-[12.5px] leading-snug text-mist">{detail}</span>
          ) : null}
        </span>
        <IconChevronRight size={17} stroke={1.75} aria-hidden className="shrink-0 text-mist" />
      </button>
    </li>
  );
}

function ActionGroup({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="border-t border-hairline pt-3 first:border-t-0 first:pt-0">
      <h4 id={id} className="mb-1 px-3 text-[12.5px] text-slate">
        {title}
      </h4>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

function Check({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-hairline px-3.5 py-3 has-[:checked]:border-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
      <span
        aria-hidden
        className={cx(
          'mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-[5px] border',
          checked ? 'border-ink bg-ink' : 'border-edge bg-canvas',
        )}
      >
        {checked ? <IconCheck size={13} stroke={2.6} className="text-canvas" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] text-ink">{label}</span>
        {hint ? <span className="mt-0.5 block text-[12.5px] leading-snug text-mist">{hint}</span> : null}
      </span>
    </label>
  );
}

/**
 * The nights someone chose: when they are, what's there now, and a short list of what can be done
 * with them (as Guesty lays it out). Choosing one shows only what that one needs.
 */
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
  const summary = useMemo(() => summarise(selection, rows, today), [selection, rows, today]);
  const [action, setAction] = useState<Action | null>(null);
  const [form, setForm] = useState<ChangeForm>(() => newForm(summary));
  const [tried, setTried] = useState(false);
  const save = useChangeCalendar(orgId);
  const firstId = useId();
  const lastId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const menu = useRef<HTMLDivElement>(null);
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

  // Moving between the list and an action takes the keyboard (and a screen reader) along.
  useEffect(() => {
    if (action) heading.current?.focus();
    else menu.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
  }, [action]);

  const choose = (next: Action) => {
    const base = newForm(summary);
    const allNoArrivals = summary.cells > 0 && summary.noArrivals === summary.cells;
    const allNoDepartures = summary.cells > 0 && summary.noDepartures === summary.cells;
    const forms: Record<Action, Partial<ChangeForm>> = {
      price: { price: 'set' },
      minStay: { minStay: 'set' },
      usual: { price: allPricedElsewhere ? 'keep' : 'usual', minStay: 'usual' },
      block: { availability: 'block' },
      owner: { availability: 'block', blockReason: 'Owner staying' },
      open: { availability: 'open' },
      arrivals: {
        arrivals: allNoArrivals ? 'closed' : 'allowed',
        departures: allNoDepartures ? 'closed' : 'allowed',
      },
    };
    setForm({ ...base, ...forms[next] });
    setTried(false);
    save.reset();
    setAction(next);
  };

  const submit = () => {
    setTried(true);
    if (!change) return;
    save.mutate(change, { onSuccess: (result) => onDone(resultMessage(result)) });
  };

  const now: string[] = [];
  if (summary.prices) now.push(`${priceRange(summary.prices, currency, locale)} a night`);
  if (summary.minNights) {
    const { low, high } = summary.minNights;
    now.push(
      low === high ? `minimum stay ${plural(low, 'night')}` : `minimum stays ${low} to ${high} nights`,
    );
  }
  const priceNow = summary.prices ? `Now ${priceRange(summary.prices, currency, locale)}` : null;
  const stayNow = summary.minNights
    ? summary.minNights.low === summary.minNights.high
      ? `Now ${plural(summary.minNights.low, 'night')}`
      : `Now ${summary.minNights.low} to ${summary.minNights.high} nights`
    : null;
  // The button says what will happen: "Block 2 nights" when one of three is booked.
  const changing = nightsToChange(form, selection, rows, today);
  const blocking = action === 'block' || action === 'owner';
  const verb = blocking ? 'Block' : action === 'open' ? 'Open' : 'Save';
  const nothingLeft = form.days.length > 0 && changing === 0 && (blocking || action === 'open');
  const saveLabel = nothingLeft
    ? blocking
      ? 'Nothing to block'
      : 'Nothing to open'
    : changing > 0
      ? `${verb} ${plural(changing, 'night')}`
      : verb;

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-6 md:px-6">
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

        {action === null ? (
          <div ref={menu} className="flex flex-col gap-3">
            <h3 className="text-[15px] font-medium text-ink">Choose what to do</h3>
            <ActionGroup title="Price and minimum stay">
              <ActionRow
                label={ACTION_TITLES.price}
                detail={allPricedElsewhere ? 'PriceLabs sets the prices here' : priceNow}
                disabled={allPricedElsewhere}
                onClick={() => choose('price')}
              />
              <ActionRow label={ACTION_TITLES.minStay} detail={stayNow} onClick={() => choose('minStay')} />
              {summary.own ? (
                <ActionRow
                  label={ACTION_TITLES.usual}
                  detail={`${plural(summary.own, 'night')} with a price or stay of their own`}
                  onClick={() => choose('usual')}
                />
              ) : null}
            </ActionGroup>
            <ActionGroup title="Availability">
              <ActionRow
                label={ACTION_TITLES.block}
                detail="For maintenance, a deep clean or anything else"
                onClick={() => choose('block')}
              />
              <ActionRow
                label={ACTION_TITLES.owner}
                detail="Blocks the nights for the owner"
                onClick={() => choose('owner')}
              />
              {summary.blocked ? (
                <ActionRow
                  label={ACTION_TITLES.open}
                  detail={`${plural(summary.blocked, 'night')} blocked now`}
                  onClick={() => choose('open')}
                />
              ) : null}
            </ActionGroup>
            <ActionGroup title="Arrivals and departures">
              <ActionRow
                label={ACTION_TITLES.arrivals}
                detail={
                  summary.noArrivals || summary.noDepartures
                    ? [
                        summary.noArrivals ? `no arrivals on ${plural(summary.noArrivals, 'night')}` : null,
                        summary.noDepartures
                          ? `no departures on ${plural(summary.noDepartures, 'night')}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(', ')
                        .replace(/^./, (c) => c.toUpperCase())
                    : 'Guests can arrive and leave on any of these nights'
                }
                onClick={() => choose('arrivals')}
              />
            </ActionGroup>
            {summary.notSent.length ? <Hint>{notSentLine(summary.notSent)}</Hint> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <div>
              <button
                type="button"
                onClick={() => setAction(null)}
                className="-ml-2.5 inline-flex items-center gap-1.5 text-[13px] action"
              >
                <IconArrowLeft size={15} stroke={1.75} aria-hidden />
                All actions
              </button>
              <h3 ref={heading} tabIndex={-1} className="mt-3 text-[17px] font-medium text-ink outline-none">
                {ACTION_TITLES[action]}
              </h3>
            </div>

            {action === 'price' ? (
              <>
                {summary.pricedByPriceLabs.length ? (
                  <Hint>
                    PriceLabs sets the prices for {propertyNames(summary.pricedByPriceLabs)}, so theirs stay
                    as they are.
                  </Hint>
                ) : null}
                <MoneyField
                  label="Price a night"
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
              </>
            ) : null}

            {action === 'minStay' ? (
              <div className="border-y border-hairline">
                <Stepper
                  label="Minimum stay"
                  hint="Nights, for guests arriving on these nights"
                  value={form.minNights}
                  min={1}
                  max={60}
                  onChange={(v) => set('minNights', v)}
                />
              </div>
            ) : null}

            {action === 'usual' ? (
              <div className="flex flex-col gap-2.5">
                <Check
                  label="The price"
                  hint={
                    allPricedElsewhere
                      ? 'PriceLabs sets the prices here.'
                      : one
                        ? `Back to ${usualPrice(one, currency, locale)}.`
                        : 'Each property goes back to its own usual price.'
                  }
                  checked={form.price === 'usual'}
                  onChange={(on) => set('price', on && !allPricedElsewhere ? 'usual' : 'keep')}
                />
                <Check
                  label="The minimum stay"
                  hint={
                    one
                      ? `Back to ${plural(one.minNights, 'night')}.`
                      : 'Each property goes back to its own usual minimum.'
                  }
                  checked={form.minStay === 'usual'}
                  onChange={(on) => set('minStay', on ? 'usual' : 'keep')}
                />
              </div>
            ) : null}

            {action === 'block' || action === 'owner' ? (
              <>
                <Hint>Free nights are blocked on every channel. Booked nights stay as they are.</Hint>
                {action === 'block' ? (
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
                ) : null}
                <TextField
                  label="Reason"
                  value={form.blockReason}
                  onChange={(v) => set('blockReason', v)}
                  max={200}
                  hint="Shown on the calendar. Guests never see it."
                />
              </>
            ) : null}

            {action === 'open' ? (
              <Hint>The blocked nights open again on every channel. Bookings stay as they are.</Hint>
            ) : null}

            {action === 'arrivals' ? (
              <div className="flex flex-col gap-2.5">
                <Check
                  label="No arrivals"
                  hint="Guests can't start a stay on these nights."
                  checked={form.arrivals === 'closed'}
                  onChange={(on) => set('arrivals', on ? 'closed' : 'allowed')}
                />
                <Check
                  label="No departures"
                  hint="Guests can't end a stay on these days."
                  checked={form.departures === 'closed'}
                  onChange={(on) => set('departures', on ? 'closed' : 'allowed')}
                />
              </div>
            ) : null}

            {nights > 1 ? (
              <details
                className="group rounded-lg border border-hairline px-3.5 py-2.5"
                open={form.days.length < ALL_DAYS.length}
              >
                <summary className="cursor-pointer text-[13.5px] text-ink marker:text-mist">
                  Only on some days of the week
                </summary>
                <fieldset className="mt-3 flex flex-col gap-2">
                  <legend className="sr-only">Days of the week</legend>
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
                              set(
                                'days',
                                on ? form.days.filter((d) => d !== day) : [...form.days, day].sort(),
                              )
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
              </details>
            ) : null}

            {summary.notSent.length ? <Notice>{notSentLine(summary.notSent)}</Notice> : null}
          </div>
        )}
      </div>

      {action ? (
        <footer className="flex flex-col gap-3 border-t border-hairline px-5 py-4 md:px-6">
          {save.error ? (
            <Notice tone="urgent">
              {save.error instanceof ApiError ? save.error.message : 'The change was not saved. Try again.'}
            </Notice>
          ) : tried && errors.form ? (
            <p className="text-[12.5px] text-urgent">{errors.form}</p>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <Button variant="quiet" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submit}
              disabled={!hasChanges(form) || save.isPending || nothingLeft}
            >
              {save.isPending ? 'Saving' : saveLabel}
            </Button>
          </div>
        </footer>
      ) : null}
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

/**
 * One booking: what it is at a glance, with the three things people do next. Open reservation goes
 * to its page; Edit changes the guest's details, agreed times and notes here; Message guest offers
 * the ways to reach them. Whatever the API adds to the calendar's line fills in once it loads.
 */
function StayBody({
  stay,
  property,
  orgId,
  canEditBooking,
  currency,
  locale,
}: {
  stay: CalendarStay;
  property: CalendarProperty | null;
  orgId: string;
  canEditBooking: boolean;
  currency: string;
  locale: string;
}) {
  const booking = useReservation(orgId, stay.id);
  const notesId = useId();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const r = booking.data;
  const nights = nightsBetween(stay.checkIn, stay.checkOut);
  const times = r ? stayTimes(r) : null;

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 4000);
    return () => window.clearTimeout(timer);
  }, [saved]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-5 py-3 md:px-6">
        <Link
          to={`/reservations/${stay.id}`}
          className="inline-flex h-9 items-center justify-center rounded-md bg-ink px-4 text-[13.5px] font-medium text-canvas transition-colors hover:bg-ink/88"
        >
          Open reservation
        </Link>
        {canEditBooking ? (
          <Button onClick={() => setEditing(true)} disabled={!r || editing}>
            <IconPencil size={16} stroke={1.75} aria-hidden className="text-slate" />
            Edit
          </Button>
        ) : null}
        {r ? <MessageGuest reservation={r} routes={contactRoutes(r)} /> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 py-6 md:px-6">
        {stay.status === 'conflict' ? (
          <Notice tone="urgent">
            This booking came in over another one, so it holds no nights. Sort it out with the guest and the
            channel, then cancel one of them there.
          </Notice>
        ) : null}
        {saved ? <Notice tone="done">Saved.</Notice> : null}
        {booking.error ? (
          <Notice tone="urgent">
            {booking.error instanceof ApiError ? booking.error.message : 'The booking’s details didn’t load.'}
          </Notice>
        ) : null}
        {editing && r ? (
          <ReservationEditor
            orgId={orgId}
            reservation={r}
            onCancel={() => setEditing(false)}
            onDone={(changed) => {
              setEditing(false);
              setSaved(changed);
            }}
          />
        ) : (
          <>
            <dl>
              <Fact label="Status">
                <StatusLabel status={stay.status} />
              </Fact>
              <Fact label="Booked on">
                <ChannelName channel={stay.channel} reference={stay.channelReference} />
              </Fact>
              {property ? <Fact label="Property">{property.name}</Fact> : null}
              <Fact label="Check-in">
                {shortNight(stay.checkIn)}
                {times ? `, from ${times.checkIn}` : ''}
                {times?.checkInAgreed ? <span className="text-slate"> (agreed)</span> : null}
              </Fact>
              <Fact label="Check-out">
                {shortNight(stay.checkOut)}
                {times ? `, by ${times.checkOut}` : ''}
                {times?.checkOutAgreed ? <span className="text-slate"> (agreed)</span> : null}
              </Fact>
              <Fact label="Nights">{nights}</Fact>
              <Fact label="Guests">{r ? partyLabel(r) : stay.guests}</Fact>
              {r?.totalMinor != null && r.currency ? (
                <Fact label="Total">
                  <span className="tnum">
                    {formatMoney({ amountMinor: r.totalMinor, currency: r.currency ?? currency }, locale)}
                  </span>
                </Fact>
              ) : null}
              {r?.guestEmail ? <Fact label="Email">{r.guestEmail}</Fact> : null}
              {r?.guestPhone ? <Fact label="Phone">{r.guestPhone}</Fact> : null}
            </dl>
            {r?.notes ? (
              <section aria-labelledby={notesId}>
                <h3 id={notesId} className="text-[13px] text-slate">
                  Notes for the team
                </h3>
                <p className="mt-1.5 text-[14px] leading-relaxed whitespace-pre-line text-ink">{r.notes}</p>
              </section>
            ) : null}
          </>
        )}
      </div>
    </>
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
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    // Closed, the keyboard goes back to the night, booking or block it was opened from.
    return () => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  const propertyOf = (id: string) => rows.find((r) => r.property.id === id)?.property ?? null;
  let title: string;
  let subtitle: string;
  if (target.kind === 'change') {
    const s = target.selection;
    const count = nightsBetween(s.firstNight, s.lastNight) + 1;
    const chosen = rows.filter((r) => s.propertyIds.includes(r.property.id)).map((r) => r.property);
    // The property first, as on Guesty; the nights under it.
    title = chosen.length === 1 ? (chosen[0]?.name ?? '') : `${chosen.length} properties`;
    subtitle = `${plural(count, 'night')}, ${count === 1 ? shortNight(s.firstNight) : rangeLabel(s.firstNight, s.lastNight)}${chosen.length > 1 ? `: ${propertyNames(chosen)}` : ''}`;
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
          <StayBody
            stay={target.stay}
            property={propertyOf(target.stay.propertyId)}
            orgId={props.orgId}
            canEditBooking={props.canEditBookings}
            currency={props.currency}
            locale={props.locale}
          />
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
