import { IconCheck, IconCircleCheck, IconCloudCheck, IconX } from '@tabler/icons-react';
import {
  can,
  PRICE_OWNERS,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPES,
  type PriceOwner,
  type Property,
  type PropertyType,
  SPACE_TYPE_LABELS,
  SPACE_TYPES,
  type SpaceType,
  suggestPropertyCode,
} from '@v01/shared';
import { type FormEvent, type ReactNode, type Ref, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { OptionRow, OptionTile, Stepper } from '../../components/choices.tsx';
import { Field, Notice } from '../../components/ui.tsx';
import { ApiError, useAddProperty, useProperties, useWorkspace } from '../../lib/api.ts';
import { V01 } from '../../lib/format.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import {
  addressText,
  clearDraft,
  countryOptions,
  isDirty,
  limitsText,
  loadDraft,
  newDraft,
  type PropertyDraft,
  placeText,
  priceErrors,
  priceOwnerText,
  roomsText,
  STEPS,
  saveDraft,
  stepSummary,
  TIMES,
  toCreate,
} from './draft.ts';
import { PRICE_OWNER_ICONS, PROPERTY_TYPE_ICONS, SPACE_TYPE_ICONS } from './icons.ts';
import { ListingPreview } from './ListingPreview.tsx';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

const SPACE_DESCRIPTIONS: Record<SpaceType, string> = {
  entire_place: 'Guests have it to themselves.',
  private_room: 'Guests have their own room and share the rest.',
  shared_room: 'Guests sleep in a room or space they share.',
};

const PRICE_OWNER_CHOICES: Record<PriceOwner, { label: string; description: string }> = {
  v01: { label: `You, in ${V01}`, description: `Set nightly prices on ${V01}'s calendar.` },
  pricelabs: { label: 'PriceLabs', description: "Prices come in from PriceLabs once it's connected." },
};

const STEP_INDEX = Object.fromEntries(STEPS.map((s, i) => [s.id, i])) as Record<
  (typeof STEPS)[number]['id'],
  number
>;

/** Opens over the property list at /properties/new, for people who may add properties. */
export function NewPropertyPanel() {
  const { orgId, entry } = useCurrentWorkspace();
  if (!can(entry.role, 'properties.write')) return <Navigate to="/properties" replace />;
  return <Panel orgId={orgId} organisationName={entry.organisationName} />;
}

function Question({
  children,
  hint,
  headingRef,
}: {
  children: ReactNode;
  hint?: ReactNode;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  return (
    <div>
      <h3
        ref={headingRef}
        tabIndex={-1}
        className="font-serif text-[30px] leading-[1.1] font-light tracking-[-0.012em] text-ink outline-none md:text-[38px]"
      >
        {children}
      </h3>
      {hint ? <p className="mt-3 max-w-[54ch] text-[14.5px] leading-relaxed text-slate">{hint}</p> : null}
    </div>
  );
}

function SubQuestion({ children }: { children: ReactNode }) {
  return <h4 className="mt-12 font-serif text-[23px] leading-tight font-normal text-ink">{children}</h4>;
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  options: { value: string; label: string }[];
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] text-slate">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md border border-edge bg-white px-2.5 text-[14px] text-ink focus:border-accent focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function MoneyField({
  label,
  value,
  onChange,
  symbol,
  error,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  symbol: string;
  error?: string;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] text-slate">
        {label}
      </label>
      <div className="relative">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[14px] text-mist"
        >
          {symbol}
        </span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-9 w-full rounded-md border border-edge bg-white pr-3 pl-7 text-[14px] text-ink placeholder:text-mist focus:border-accent focus:outline-none aria-invalid:border-urgent"
        />
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-[12.5px] text-urgent">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ReviewRow({ title, children, onChange }: { title: string; children: ReactNode; onChange(): void }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 py-4 @lg:grid-cols-[150px_minmax(0,1fr)_auto]">
      <dt className="text-[13.5px] text-slate">{title}</dt>
      <dd className="col-start-1 text-[14.5px] leading-relaxed text-ink @lg:col-start-2">{children}</dd>
      <dd className="col-start-2 row-span-2 row-start-1 @lg:col-start-3 @lg:row-span-1">
        <button
          type="button"
          onClick={onChange}
          className="text-[13.5px] text-accent underline-offset-4 hover:underline"
        >
          Change<span className="sr-only"> {title.toLowerCase()}</span>
        </button>
      </dd>
    </div>
  );
}

function Panel({ orgId, organisationName }: { orgId: string; organisationName: string }) {
  const navigate = useNavigate();
  const workspace = useWorkspace(orgId);
  const existing = useProperties(orgId);
  const add = useAddProperty(orgId);
  const currency = workspace.data?.settings.currency ?? 'GBP';
  const locale = workspace.data?.settings.locale ?? 'en-GB';
  const ownCountry = workspace.data?.settings.countryCode ?? 'GB';

  const [restored] = useState(() => loadDraft(orgId));
  const [draft, setDraft] = useState<PropertyDraft>(() => restored?.draft ?? newDraft(ownCountry));
  const [step, setStep] = useState(() => restored?.step ?? 0);
  const [visited, setVisited] = useState<number[]>(() => restored?.visited ?? [0]);
  const [showRestored, setShowRestored] = useState(() => Boolean(restored && isDirty(restored.draft)));
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [created, setCreated] = useState<Property | null>(null);

  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const formId = useId();
  const titleId = useId();

  const takenCodes = useMemo(
    () => (existing.data?.properties ?? []).map((p) => p.internalCode).filter((c): c is string => Boolean(c)),
    [existing.data],
  );
  const symbol = useMemo(
    () =>
      new Intl.NumberFormat(locale, { style: 'currency', currency })
        .formatToParts(0)
        .find((part) => part.type === 'currency')?.value ?? currency,
    [currency, locale],
  );
  const prices = priceErrors(draft, currency);
  const furthest = Math.max(...visited);
  const current = STEPS[step] ?? STEPS[0];
  const isLast = step === STEPS.length - 1;

  // Open as a modal: focus stays inside, Escape closes, and the page behind doesn't scroll.
  useEffect(() => {
    dialog.current?.showModal();
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = before;
    };
  }, []);

  // Each new question starts at the top, with focus on it for keyboards and screen readers.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on purpose whenever the step or outcome changes
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [step, created]);

  // Keep the draft in this browser as it changes, so closing never loses an answer.
  useEffect(() => {
    if (created) return;
    if (isDirty(draft) || step > 0) saveDraft(orgId, { draft, step, visited });
  }, [orgId, draft, step, visited, created]);

  const close = () => navigate('/properties');
  const update = (patch: Partial<PropertyDraft>) => setDraft((d) => ({ ...d, ...patch }));

  function go(index: number) {
    setStep(index);
    setVisited((v) => (v.includes(index) ? v : [...v, index]));
    setShowRestored(false);
    setSubmitError(null);
  }

  function isComplete(index: number): boolean {
    if (created) return true;
    switch (STEPS[index]?.id) {
      case 'place':
        return draft.propertyType !== null;
      case 'name':
        return draft.name.trim() !== '';
      case 'rooms':
        return visited.includes(index) && furthest > index;
      case 'pricing':
        return visited.includes(index) && furthest > index && Object.keys(prices).length === 0;
      default:
        return false;
    }
  }

  async function addProperty() {
    if (!draft.name.trim()) {
      setSubmitError(null);
      return;
    }
    if (Object.keys(prices).length > 0) {
      go(STEP_INDEX.pricing);
      return;
    }
    try {
      const property = await add.mutateAsync(toCreate(draft, currency));
      clearDraft(orgId);
      setCreated(property);
    } catch (error) {
      setSubmitError(
        error instanceof ApiError ? error.message : 'The property could not be added. Try again.',
      );
    }
  }

  function next(event: FormEvent) {
    event.preventDefault();
    if (current.id === 'name' && !draft.name.trim()) {
      setNameError('Give the property a name to continue');
      return;
    }
    if (current.id === 'pricing' && Object.keys(prices).length > 0) return;
    if (isLast) void addProperty();
    else go(step + 1);
  }

  function startOver() {
    clearDraft(orgId);
    setDraft(newDraft(ownCountry));
    setStep(0);
    setVisited([0]);
    setShowRestored(false);
    setNameError(null);
    setSubmitError(null);
    setCreated(null);
  }

  function setName(name: string) {
    setNameError(null);
    setDraft((d) => ({
      ...d,
      name,
      internalCode: d.codeEdited ? d.internalCode : suggestPropertyCode(name, takenCodes),
    }));
  }

  let body: ReactNode;
  if (created) {
    body = (
      <div className="pt-4">
        <IconCircleCheck size={48} stroke={1.2} aria-hidden className="text-accent" />
        <h3
          ref={heading}
          tabIndex={-1}
          className="mt-6 font-serif text-[34px] leading-[1.1] font-light text-ink outline-none md:text-[42px]"
        >
          {created.name} is added
        </h3>
        <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-slate">
          It's on the property list now
          {created.internalCode ? `, with the short code ${created.internalCode}` : ''}. Nothing goes to
          Airbnb, Booking.com or Vrbo until its listings are connected.
        </p>
      </div>
    );
  } else if (current.id === 'place') {
    body = (
      <>
        <Question headingRef={heading} hint="Pick the closest match.">
          What kind of place is it?
        </Question>
        <div
          role="radiogroup"
          aria-label="Kind of place"
          className="mt-8 grid grid-cols-2 gap-3 @md:grid-cols-4"
        >
          {PROPERTY_TYPES.map((type) => (
            <OptionTile
              key={type}
              name="propertyType"
              value={type}
              checked={draft.propertyType === type}
              onSelect={(value) => update({ propertyType: value as PropertyType })}
              icon={PROPERTY_TYPE_ICONS[type]}
              label={PROPERTY_TYPE_LABELS[type]}
            />
          ))}
        </div>
        <SubQuestion>What will guests have?</SubQuestion>
        <div role="radiogroup" aria-label="What guests have" className="mt-4 grid gap-3">
          {SPACE_TYPES.map((space) => (
            <OptionRow
              key={space}
              name="spaceType"
              value={space}
              checked={draft.spaceType === space}
              onSelect={(value) => update({ spaceType: value as SpaceType })}
              icon={SPACE_TYPE_ICONS[space]}
              label={SPACE_TYPE_LABELS[space]}
              description={SPACE_DESCRIPTIONS[space]}
            />
          ))}
        </div>
      </>
    );
  } else if (current.id === 'name') {
    body = (
      <>
        <Question
          headingRef={heading}
          hint="Your team sees this name. Each channel listing keeps its own title."
        >
          What do you call it?
        </Question>
        <div className="mt-8 grid gap-4 @md:grid-cols-[minmax(0,1fr)_150px]">
          <Field
            label="Name"
            value={draft.name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Harbour View Lodge"
            autoComplete="off"
            maxLength={120}
            error={nameError ?? undefined}
          />
          <Field
            label="Short code"
            value={draft.internalCode}
            onChange={(e) => update({ internalCode: e.target.value.toUpperCase(), codeEdited: true })}
            hint={draft.codeEdited ? 'For the calendar and reports' : 'Made from the name'}
            autoComplete="off"
            maxLength={12}
          />
        </div>
        <SubQuestion>Where is it?</SubQuestion>
        <div className="mt-4 grid gap-4">
          <Field
            label="Street address"
            value={draft.addressLine1}
            onChange={(e) => update({ addressLine1: e.target.value })}
            autoComplete="address-line1"
            maxLength={200}
          />
          <div className="grid gap-4 @md:grid-cols-[minmax(0,1fr)_170px]">
            <Field
              label="Town or city"
              value={draft.city}
              onChange={(e) => update({ city: e.target.value })}
              autoComplete="address-level2"
              maxLength={100}
            />
            <Field
              label="Postcode"
              value={draft.postcode}
              onChange={(e) => update({ postcode: e.target.value.toUpperCase() })}
              autoComplete="postal-code"
              maxLength={20}
            />
          </div>
          <Field
            label="Area"
            value={draft.area}
            onChange={(e) => update({ area: e.target.value })}
            hint="A neighbourhood or district. Reports and the calendar group properties by area."
            maxLength={100}
          />
          <SelectField
            label="Country"
            value={draft.countryCode}
            onChange={(countryCode) => update({ countryCode })}
            options={countryOptions(ownCountry).map((c) => ({ value: c.code, label: c.name }))}
          />
        </div>
      </>
    );
  } else if (current.id === 'rooms') {
    body = (
      <>
        <Question headingRef={heading} hint="Count what's really there. The channels show these to guests.">
          How many guests can stay?
        </Question>
        <div className="mt-6 divide-y divide-hairline border-y border-hairline">
          <Stepper
            label="Guests"
            value={draft.maxGuests}
            min={1}
            max={50}
            onChange={(n) => update({ maxGuests: n })}
          />
          <Stepper
            label="Bedrooms"
            hint="0 for a studio"
            value={draft.bedrooms}
            min={0}
            max={50}
            onChange={(n) => update({ bedrooms: n })}
          />
          <Stepper label="Beds" value={draft.beds} min={1} max={50} onChange={(n) => update({ beds: n })} />
          <Stepper
            label="Bathrooms"
            hint="One with only a toilet and basin counts as a half"
            value={draft.bathrooms}
            min={0}
            max={20}
            step={0.5}
            onChange={(n) => update({ bathrooms: n })}
          />
        </div>
        <SubQuestion>When do guests arrive and leave?</SubQuestion>
        <div className="mt-4 grid gap-4 @md:grid-cols-2">
          <SelectField
            label="Check-in from"
            value={draft.checkInTime}
            onChange={(checkInTime) => update({ checkInTime })}
            options={TIMES.map((t) => ({ value: t, label: t }))}
          />
          <SelectField
            label="Check-out by"
            value={draft.checkOutTime}
            onChange={(checkOutTime) => update({ checkOutTime })}
            options={TIMES.map((t) => ({ value: t, label: t }))}
          />
        </div>
      </>
    );
  } else if (current.id === 'pricing') {
    body = (
      <>
        <Question headingRef={heading} hint="This decides where each night's price comes from.">
          Who sets the nightly price?
        </Question>
        <div role="radiogroup" aria-label="Who sets the price" className="mt-8 grid gap-3">
          {PRICE_OWNERS.map((owner) => (
            <OptionRow
              key={owner}
              name="priceOwner"
              value={owner}
              checked={draft.priceOwner === owner}
              onSelect={(value) => update({ priceOwner: value as PriceOwner })}
              icon={PRICE_OWNER_ICONS[owner]}
              label={PRICE_OWNER_CHOICES[owner].label}
              description={PRICE_OWNER_CHOICES[owner].description}
            />
          ))}
        </div>
        <SubQuestion>Price limits</SubQuestion>
        <p className="mt-2 max-w-[56ch] text-[14px] leading-relaxed text-slate">
          A nightly price outside these limits never reaches Airbnb, Booking.com or Vrbo, whoever set it.
          Leave them empty to add later.
        </p>
        <div className="mt-4 grid gap-4 @md:grid-cols-2">
          <MoneyField
            label="Lowest nightly price"
            value={draft.minPrice}
            onChange={(minPrice) => update({ minPrice })}
            symbol={symbol}
            error={prices.minPrice}
          />
          <MoneyField
            label="Highest nightly price"
            value={draft.maxPrice}
            onChange={(maxPrice) => update({ maxPrice })}
            symbol={symbol}
            error={prices.maxPrice}
          />
        </div>
      </>
    );
  } else {
    const limits = limitsText(draft, currency, locale);
    const address = addressText(draft);
    body = (
      <>
        <Question headingRef={heading} hint="Change anything before you add it.">
          Does this look right?
        </Question>
        <div className="mt-8 xl:hidden">
          <ListingPreview draft={draft} currency={currency} locale={locale} compact />
        </div>
        <dl className="mt-8 divide-y divide-hairline border-y border-hairline">
          <ReviewRow title="The place" onChange={() => go(STEP_INDEX.place)}>
            {placeText(draft) ?? <span className="text-mist">Not chosen yet</span>}
          </ReviewRow>
          <ReviewRow title="Name and address" onChange={() => go(STEP_INDEX.name)}>
            {draft.name.trim() ? (
              <>
                {draft.name.trim()}
                {draft.internalCode.trim() ? ` (${draft.internalCode.trim()})` : ''}
                {address ? (
                  <>
                    <br />
                    <span className="text-slate">{address}</span>
                  </>
                ) : null}
              </>
            ) : (
              <span className="text-urgent">No name yet</span>
            )}
          </ReviewRow>
          <ReviewRow title="Guests and rooms" onChange={() => go(STEP_INDEX.rooms)}>
            {roomsText(draft)}
            <br />
            <span className="text-slate">
              Check-in from {draft.checkInTime}, check-out by {draft.checkOutTime}
            </span>
          </ReviewRow>
          <ReviewRow title="Pricing" onChange={() => go(STEP_INDEX.pricing)}>
            {priceOwnerText(draft)}
            <br />
            {Object.keys(prices).length > 0 ? (
              <span className="text-urgent">The price limits need fixing</span>
            ) : (
              <span className="text-slate">{limits ?? 'No price limits yet'}</span>
            )}
          </ReviewRow>
        </dl>
        {!draft.name.trim() ? (
          <div className="mt-6">
            <Notice>
              A property needs a name before it can be added.{' '}
              <button
                type="button"
                onClick={() => go(STEP_INDEX.name)}
                className="text-accent underline-offset-4 hover:underline"
              >
                Add a name
              </button>
            </Notice>
          </div>
        ) : null}
        {submitError ? (
          <div className="mt-6">
            <Notice tone="urgent">{submitError}</Notice>
          </div>
        ) : null}
      </>
    );
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the panel through onCancel; this only catches clicks on the dimmed page beside it
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        // A click on the dimmed page beside the panel closes it; the draft is kept.
        if (event.target === dialog.current) close();
      }}
      className="sheet fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-none border-l border-hairline bg-canvas p-0 text-ink md:w-[calc(100vw-56px)] xl:w-[min(1280px,calc(100vw-96px))]"
    >
      <div className="flex h-full flex-col pt-[env(safe-area-inset-top,0px)]">
        <header className="flex items-center justify-between gap-4 border-b border-hairline px-5 py-3 md:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[15px] font-medium text-ink">
              New property
            </h2>
            <p className="truncate text-[12.5px] text-mist">{organisationName}</p>
          </div>
          <div className="flex items-center gap-4">
            {!created && isDirty(draft) ? (
              <span
                className="hidden items-center gap-1.5 text-[12.5px] text-mist sm:inline-flex"
                title="Kept in this browser until you add the property"
              >
                <IconCloudCheck size={16} stroke={1.6} aria-hidden />
                Draft kept
              </span>
            ) : null}
            <button
              type="button"
              onClick={close}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-hairline px-3 text-[13.5px] text-ink transition-colors hover:bg-linen"
            >
              <IconX size={16} stroke={1.75} aria-hidden />
              Close
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[264px_minmax(0,1fr)] xl:grid-cols-[264px_minmax(0,1fr)_340px] 2xl:grid-cols-[264px_minmax(0,1fr)_380px]">
          {/* The spine: every step, with the answers so far. Any step is one click away. */}
          <nav
            aria-label="Steps"
            className="hidden min-h-0 flex-col overflow-y-auto border-r border-hairline bg-paper px-3 py-8 md:flex"
          >
            <ol>
              {STEPS.map((s, i) => {
                const done = isComplete(i);
                const here = i === step && !created;
                const summary = stepSummary(
                  s.id,
                  draft,
                  visited.includes(i) && furthest > i,
                  currency,
                  locale,
                );
                return (
                  <li key={s.id} className="relative">
                    {i < STEPS.length - 1 ? (
                      <span
                        aria-hidden
                        className={cx(
                          'absolute top-[38px] bottom-[-6px] left-[25px] w-px transition-colors duration-300',
                          done ? 'bg-accent' : 'bg-hairline',
                        )}
                      />
                    ) : null}
                    <button
                      type="button"
                      disabled={Boolean(created)}
                      onClick={() => go(i)}
                      aria-current={here ? 'step' : undefined}
                      className={cx(
                        'relative grid w-full grid-cols-[28px_minmax(0,1fr)] gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors disabled:cursor-default',
                        here ? 'bg-canvas' : 'hover:bg-linen/70',
                      )}
                    >
                      <span
                        aria-hidden
                        className={cx(
                          'grid size-7 place-items-center rounded-full text-[12.5px] font-medium transition-colors duration-300',
                          done && !here && 'bg-accent text-canvas',
                          here && 'bg-canvas text-accent shadow-[inset_0_0_0_1.5px_var(--color-accent)]',
                          !done && !here && 'border border-edge text-mist',
                        )}
                      >
                        {done && !here ? <IconCheck size={14} stroke={2.5} /> : i + 1}
                      </span>
                      <span className="min-w-0 pt-[3px]">
                        <span className={cx('block text-[14px]', here ? 'font-medium text-ink' : 'text-ink')}>
                          {s.title}
                        </span>
                        {summary ? (
                          <span
                            className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-slate"
                            title={summary}
                          >
                            {summary}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="mt-auto px-2.5 pt-8 text-[12.5px] leading-relaxed text-mist">
              Only a name is needed to add it. Everything else starts with a sensible answer, and closing
              keeps your draft.
            </p>
          </nav>

          <div
            ref={scroller}
            className="min-h-0 overflow-y-auto px-5 py-8 md:px-12 md:py-12 xl:px-10 2xl:px-12"
          >
            <div className="@container max-w-[620px]">
              {!created ? (
                <div className="mb-8 md:hidden">
                  <div className="flex gap-1.5" aria-hidden>
                    {STEPS.map((s, i) => (
                      <span
                        key={s.id}
                        className={cx(
                          'h-1 flex-1 rounded-full transition-colors',
                          i === step ? 'bg-ink' : isComplete(i) ? 'bg-accent' : 'bg-hairline',
                        )}
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-[12.5px] text-mist">
                    Step {step + 1} of {STEPS.length}: {current.title}
                  </p>
                </div>
              ) : null}
              {showRestored ? (
                <div className="mb-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl bg-paper px-4 py-3 text-[13.5px] text-ink">
                  <span>Picked up where you left off.</span>
                  <button
                    type="button"
                    onClick={startOver}
                    className="text-accent underline-offset-4 hover:underline"
                  >
                    Start over
                  </button>
                </div>
              ) : null}
              <form id={formId} onSubmit={next} noValidate>
                {body}
              </form>
            </div>
          </div>

          <aside
            aria-label="Preview"
            className="hidden min-h-0 overflow-y-auto border-l border-hairline px-7 py-12 xl:block 2xl:px-8"
          >
            <ListingPreview draft={draft} currency={currency} locale={locale} />
          </aside>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-hairline bg-canvas px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] md:px-6">
          {created ? (
            <>
              <span />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={startOver}
                  className="h-10 rounded-lg border border-hairline px-4 text-[14px] font-medium text-ink transition-colors hover:bg-linen"
                >
                  Add another
                </button>
                <button
                  type="button"
                  onClick={close}
                  className="h-10 rounded-lg bg-ink px-5 text-[14px] font-medium text-canvas transition-colors hover:bg-ink/88"
                >
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => go(Math.max(0, step - 1))}
                className={cx(
                  'h-10 rounded-lg px-4 text-[14px] font-medium text-ink underline-offset-4 hover:underline',
                  step === 0 && 'invisible',
                )}
              >
                Back
              </button>
              <button
                type="submit"
                form={formId}
                disabled={add.isPending}
                className="h-10 rounded-lg bg-ink px-6 text-[14px] font-medium text-canvas transition-colors hover:bg-ink/88 disabled:opacity-60"
              >
                {isLast ? (add.isPending ? 'Adding' : 'Add property') : 'Continue'}
              </button>
            </>
          )}
        </footer>
      </div>
    </dialog>
  );
}
