import { IconCheck, IconCircleCheck, IconCloudCheck, IconPhotoPlus, IconX } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  type Amenity,
  can,
  PHOTO_MAX_COUNT,
  PHOTO_MIN_TO_LIST,
  PRICE_OWNERS,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPES,
  type PriceOwner,
  type PropertyDetail,
  type PropertyType,
  SPACE_TYPE_LABELS,
  SPACE_TYPES,
  type SpaceType,
  SUMMARY_MAX,
  suggestPropertyCode,
  TITLE_MAX,
} from '@v01/shared';
import {
  type DragEvent,
  type FormEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Navigate, useNavigate } from 'react-router';
import { OptionRow, OptionTile, Stepper } from '../../components/choices.tsx';
import { MoneyField, SelectField, TextArea, TextField } from '../../components/fields.tsx';
import { Button, Field, Notice } from '../../components/ui.tsx';
import {
  ApiError,
  uploadPhotos,
  useAddProperty,
  useApiToken,
  useProperties,
  useWorkspace,
} from '../../lib/api.ts';
import { plural, V01 } from '../../lib/format.ts';
import { PHOTO_ACCEPT } from '../../lib/images.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { AmenityTile, GUEST_FAVOURITES, SAFETY_ITEMS, STANDOUT } from './AmenitiesSection.tsx';
import {
  addressText,
  amenitiesText,
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
  STAGES,
  STEPS,
  type StepId,
  saveDraft,
  stepSummary,
  suggestTitle,
  TIMES,
  toCreate,
  usualPriceText,
} from './draft.ts';
import { clearHeldPhotos, type HeldPhoto, holdPhotos, setHeldPhotos, useHeldPhotos } from './heldPhotos.ts';
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

const STEP_INDEX = Object.fromEntries(STEPS.map((s, i) => [s.id, i])) as Record<StepId, number>;

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

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
        className="font-semibold tracking-[-0.015em] text-[26px] leading-[1.1] font-light tracking-[-0.012em] text-ink outline-none md:text-[38px]"
      >
        {children}
      </h3>
      {hint ? <p className="mt-3 max-w-[54ch] text-[14.5px] leading-relaxed text-slate">{hint}</p> : null}
    </div>
  );
}

function SubQuestion({ children, first = false }: { children: ReactNode; first?: boolean }) {
  return (
    <h4
      className={cx(
        'font-semibold tracking-[-0.015em] text-[18px] leading-tight text-ink',
        first ? 'mt-9' : 'mt-12',
      )}
    >
      {children}
    </h4>
  );
}

function ReviewRow({ title, children, onChange }: { title: string; children: ReactNode; onChange(): void }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-1 py-4 @lg:grid-cols-[150px_minmax(0,1fr)_auto]">
      <dt className="text-[13.5px] text-slate">{title}</dt>
      <dd className="col-start-1 text-[14.5px] leading-relaxed text-ink @lg:col-start-2">{children}</dd>
      <dd className="col-start-2 row-span-2 row-start-1 @lg:col-start-3 @lg:row-span-1">
        <button type="button" onClick={onChange} className="text-[13.5px] action">
          Change<span className="sr-only"> {title.toLowerCase()}</span>
        </button>
      </dd>
    </div>
  );
}

/** A group of amenities as tiles: the ones guests look for, so picking takes seconds. */
function AmenityTiles({
  label,
  items,
  chosen,
  onToggle,
}: {
  label: string;
  items: Amenity[];
  chosen: string[];
  onToggle(code: string): void;
}) {
  return (
    <fieldset className="mt-4 grid grid-cols-2 gap-3 @md:grid-cols-4">
      <legend className="sr-only">{label}</legend>
      {items.map((item) => (
        <AmenityTile
          key={item.code}
          item={item}
          checked={chosen.includes(item.code)}
          onToggle={() => onToggle(item.code)}
        />
      ))}
    </fieldset>
  );
}

/** The photos chosen so far, held until the property exists: cover first, drag to reorder. */
function PhotoPicker({
  orgId,
  photos,
  problems,
  onProblems,
}: {
  orgId: string;
  photos: HeldPhoto[];
  problems: string[];
  onProblems(problems: string[]): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [checking, setChecking] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [dragged, setDragged] = useState<string | null>(null);
  const full = photos.length >= PHOTO_MAX_COUNT;

  async function add(files: File[]) {
    if (!files.length) return;
    setChecking(true);
    try {
      onProblems(await holdPhotos(orgId, files));
    } finally {
      setChecking(false);
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDropping(false);
    if (dragged) return;
    void add([...event.dataTransfer.files]);
  };

  const choose = () => input.current?.click();
  const missing = PHOTO_MIN_TO_LIST - photos.length;

  return (
    <div className="mt-8">
      <input
        ref={input}
        type="file"
        accept={PHOTO_ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void add([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dropping files is a shortcut; the buttons do the same */}
      <div
        onDragOver={(e) => {
          if (dragged || full) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
        className={cx('rounded-2xl transition-shadow', dropping && 'shadow-[0_0_0_2px_var(--color-accent)]')}
      >
        {photos.length === 0 ? (
          <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-edge bg-paper px-6 py-14 text-center">
            <IconPhotoPlus size={36} stroke={1.2} aria-hidden className="text-edge" />
            <p className="max-w-[40ch] text-[14.5px] text-ink">
              Drop photos here, or choose them from your device.
            </p>
            <p className="text-[13px] text-mist">JPEG, PNG or WebP, at least 800 pixels wide.</p>
            <Button variant="primary" onClick={choose} disabled={checking}>
              {checking ? 'Checking the photos' : 'Choose photos'}
            </Button>
          </div>
        ) : (
          <ol className="grid grid-cols-2 gap-3 @md:grid-cols-3">
            {photos.map((photo, index) => (
              <li
                key={photo.id}
                draggable
                onDragStart={(e) => {
                  setDragged(photo.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setDragged(null)}
                onDragOver={(e) => {
                  if (dragged) e.preventDefault();
                }}
                onDrop={(e) => {
                  if (!dragged || dragged === photo.id) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const ids = photos.map((p) => p.id);
                  setHeldPhotos(orgId, move(photos, ids.indexOf(dragged), index));
                  setDragged(null);
                }}
                className={cx(
                  'relative aspect-[4/3] cursor-grab overflow-hidden rounded-xl bg-paper active:cursor-grabbing',
                  dragged === photo.id && 'opacity-40',
                )}
              >
                <img
                  src={photo.url}
                  alt={`${index === 0 ? 'Cover, ' : ''}${index + 1} of ${photos.length}`}
                  className="h-full w-full object-cover"
                />
                {index === 0 ? (
                  <span className="absolute top-2 left-2 rounded-md bg-canvas px-2 py-0.5 text-[12px] font-medium text-ink shadow-[0_1px_4px_rgb(21_24_27/0.16)]">
                    Cover
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setHeldPhotos(orgId, move(photos, index, 0))}
                    className="absolute bottom-2 left-2 rounded-md bg-canvas/95 px-2 py-0.5 text-[12px] font-medium text-ink shadow-[0_1px_4px_rgb(21_24_27/0.16)] hover:bg-canvas"
                  >
                    Make cover<span className="sr-only">: photo {index + 1}</span>
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Remove photo ${index + 1}`}
                  onClick={() =>
                    setHeldPhotos(
                      orgId,
                      photos.filter((p) => p.id !== photo.id),
                    )
                  }
                  className="absolute top-2 right-2 grid size-7 place-items-center rounded-full bg-canvas/95 text-ink shadow-[0_1px_4px_rgb(21_24_27/0.16)] hover:bg-canvas"
                >
                  <IconX size={14} stroke={2} aria-hidden />
                </button>
              </li>
            ))}
            {full ? null : (
              <li>
                <button
                  type="button"
                  onClick={choose}
                  disabled={checking}
                  className="grid aspect-[4/3] w-full place-items-center rounded-xl border border-dashed border-edge text-[13.5px] text-slate transition-colors hover:border-ink hover:text-ink disabled:opacity-60"
                >
                  <span className="flex flex-col items-center gap-2">
                    <IconPhotoPlus size={24} stroke={1.4} aria-hidden />
                    {checking ? 'Checking' : 'Add more'}
                  </span>
                </button>
              </li>
            )}
          </ol>
        )}
      </div>
      {photos.length ? (
        <p role="status" className="mt-4 text-[13.5px] text-slate">
          {plural(photos.length, 'photo')}.{' '}
          {missing > 0
            ? `Airbnb needs at least ${PHOTO_MIN_TO_LIST}, so add ${missing} more when you can.`
            : 'They upload when you add the property.'}
        </p>
      ) : null}
      {problems.length ? (
        <div className="mt-4">
          <Notice tone="urgent">
            <ul className="flex flex-col gap-1">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Notice>
        </div>
      ) : null}
    </div>
  );
}

function Panel({ orgId, organisationName }: { orgId: string; organisationName: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const token = useApiToken();
  const workspace = useWorkspace(orgId);
  const existing = useProperties(orgId);
  const add = useAddProperty(orgId);
  const photos = useHeldPhotos(orgId);
  const currency = workspace.data?.settings.currency ?? 'GBP';
  const locale = workspace.data?.settings.locale ?? 'en-GB';
  const ownCountry = workspace.data?.settings.countryCode ?? 'GB';

  const [restored] = useState(() => loadDraft(orgId));
  const [draft, setDraft] = useState<PropertyDraft>(() => restored?.draft ?? newDraft(ownCountry));
  const [step, setStep] = useState(() => Math.min(restored?.step ?? 0, STEPS.length - 1));
  const [visited, setVisited] = useState<number[]>(() => restored?.visited ?? [0]);
  const [showRestored, setShowRestored] = useState(() => Boolean(restored && isDirty(restored.draft)));
  // Photos chosen before the page was reloaded are gone; say so rather than let them vanish quietly.
  const [photosLost] = useState(() => (restored?.photoCount ?? 0) > 0 && photos.length === 0);
  const [nameError, setNameError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [photoProblems, setPhotoProblems] = useState<string[]>([]);
  const [upload, setUpload] = useState<{ done: number; total: number } | null>(null);
  const [created, setCreated] = useState<{
    property: PropertyDetail;
    photosAdded: number;
    photoProblems: string[];
  } | null>(null);

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
  const titleTooLong = draft.title.trim().length > TITLE_MAX;
  const summaryTooLong = draft.summary.trim().length > SUMMARY_MAX;
  const furthest = Math.max(...visited);
  const current = STEPS[step] ?? STEPS[0];
  const isLast = step === STEPS.length - 1;
  const busy = add.isPending || upload !== null;
  const suggestion = suggestTitle(draft, TITLE_MAX);

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
    if (isDirty(draft) || step > 0 || photos.length > 0) {
      saveDraft(orgId, { draft, step, visited, photoCount: photos.length });
    }
  }, [orgId, draft, step, visited, created, photos.length]);

  const close = () => navigate('/properties');
  const update = (patch: Partial<PropertyDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const toggleAmenity = (code: string) =>
    setDraft((d) => ({
      ...d,
      amenities: d.amenities.includes(code) ? d.amenities.filter((c) => c !== code) : [...d.amenities, code],
    }));

  function go(index: number) {
    setStep(index);
    setVisited((v) => (v.includes(index) ? v : [...v, index]));
    setShowRestored(false);
    setSubmitError(null);
  }

  function isComplete(index: number): boolean {
    if (created) return true;
    const passed = visited.includes(index) && furthest > index;
    switch (STEPS[index]?.id) {
      case 'place':
        return draft.propertyType !== null;
      case 'name':
        return draft.name.trim() !== '';
      case 'rooms':
        return passed;
      case 'amenities':
        return draft.amenities.length > 0;
      case 'photos':
        return photos.length > 0;
      case 'description':
        return draft.title.trim() !== '' && !titleTooLong && !summaryTooLong;
      case 'pricing':
        return passed && Object.keys(prices).length === 0;
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
    if (titleTooLong || summaryTooLong) {
      go(STEP_INDEX.description);
      return;
    }
    let property: PropertyDetail;
    try {
      property = await add.mutateAsync(toCreate(draft, currency));
    } catch (error) {
      setSubmitError(
        error instanceof ApiError ? error.message : 'The property could not be added. Try again.',
      );
      return;
    }
    clearDraft(orgId);

    // The property exists now, so the photos held so far can go to it, one at a time.
    let photosAdded = 0;
    let problems: string[] = [];
    const files = photos.map((p) => p.file);
    if (files.length && token) {
      setUpload({ done: 0, total: files.length });
      try {
        const result = await uploadPhotos(token, orgId, property.id, files, (detail, done) => {
          if (detail) queryClient.setQueryData(['property', orgId, property.id], detail);
          setUpload({ done, total: files.length });
        });
        problems = result.problems;
        photosAdded = files.length - result.problems.length;
        if (result.detail) property = result.detail;
      } catch {
        problems = ['The photos could not be added. Add them on its page.'];
      } finally {
        setUpload(null);
        void queryClient.invalidateQueries({ queryKey: ['properties', orgId] });
        void queryClient.invalidateQueries({ queryKey: ['console'] });
      }
    }
    clearHeldPhotos(orgId);
    setCreated({ property, photosAdded, photoProblems: problems });
  }

  function next(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (current.id === 'name' && !draft.name.trim()) {
      setNameError('Give the property a name to continue');
      return;
    }
    if (current.id === 'description' && (titleTooLong || summaryTooLong)) return;
    if (current.id === 'pricing' && Object.keys(prices).length > 0) return;
    if (isLast) void addProperty();
    else go(step + 1);
  }

  function startOver() {
    clearDraft(orgId);
    clearHeldPhotos(orgId);
    setDraft(newDraft(ownCountry));
    setStep(0);
    setVisited([0]);
    setShowRestored(false);
    setNameError(null);
    setSubmitError(null);
    setPhotoProblems([]);
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
    const { property, photosAdded, photoProblems: failed } = created;
    const withWhat = [
      property.internalCode ? `the short code ${property.internalCode}` : null,
      photosAdded ? plural(photosAdded, 'photo') : null,
    ]
      .filter(Boolean)
      .join(' and ');
    body = (
      <div className="pt-4">
        <IconCircleCheck size={48} stroke={1.2} aria-hidden className="text-accent" />
        <h3
          ref={heading}
          tabIndex={-1}
          className="mt-6 font-semibold tracking-[-0.02em] text-[28px] leading-[1.15] text-ink outline-none md:text-[34px]"
        >
          {property.name} is added
        </h3>
        <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-slate">
          It's on the property list now{withWhat ? `, with ${withWhat}` : ''}. Nothing goes to Airbnb,
          Booking.com or Vrbo until its listings are connected.
        </p>
        {failed.length ? (
          <div className="mt-6 max-w-[56ch]">
            <Notice tone="urgent">
              <p>Some photos didn't upload. Add them again on its page.</p>
              <ul className="mt-1 flex flex-col gap-0.5">
                {failed.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </Notice>
          </div>
        ) : null}
        <p className="mt-8 max-w-[52ch] border-t border-hairline pt-6 text-[14.5px] leading-relaxed text-ink">
          Next, on its page: house rules, how guests get in, the beds in each room and the licence number. Its
          checklist shows what the channels still need.
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
          hint="Your team sees this name. Guests see the listing's title, which comes a little later."
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
  } else if (current.id === 'amenities') {
    body = (
      <>
        <Question
          headingRef={heading}
          hint="Pick everything that's there. Guests filter their searches by these, and standout features lead the listing."
        >
          What does it offer?
        </Question>
        <SubQuestion first>Guest favourites</SubQuestion>
        <AmenityTiles
          label="Guest favourites"
          items={GUEST_FAVOURITES}
          chosen={draft.amenities}
          onToggle={toggleAmenity}
        />
        <SubQuestion>Standout features</SubQuestion>
        <AmenityTiles
          label="Standout features"
          items={STANDOUT}
          chosen={draft.amenities}
          onToggle={toggleAmenity}
        />
        <SubQuestion>Safety</SubQuestion>
        <AmenityTiles label="Safety" items={SAFETY_ITEMS} chosen={draft.amenities} onToggle={toggleAmenity} />
        <p className="mt-8 max-w-[56ch] text-[13.5px] leading-relaxed text-slate">
          The full list, from a cot to a boot room, is on its page once it's added.
        </p>
      </>
    );
  } else if (current.id === 'photos') {
    body = (
      <>
        <Question
          headingRef={heading}
          hint={`Airbnb asks for at least ${PHOTO_MIN_TO_LIST}. Lead with the best room in daylight. The first is the cover, and you can drag them into any order.`}
        >
          What does it look like?
        </Question>
        {photosLost ? (
          <div className="mt-6">
            <Notice>The photos chosen before the page was reloaded need choosing again.</Notice>
          </div>
        ) : null}
        <PhotoPicker orgId={orgId} photos={photos} problems={photoProblems} onProblems={setPhotoProblems} />
      </>
    );
  } else if (current.id === 'description') {
    body = (
      <>
        <Question
          headingRef={heading}
          hint={`The title is the first thing guests read, so keep it short. Airbnb allows ${TITLE_MAX} characters.`}
        >
          How should the listing read?
        </Question>
        <div className="mt-8 flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <TextField
              label="Title"
              value={draft.title}
              onChange={(title) => update({ title })}
              max={TITLE_MAX}
              placeholder={suggestion ?? 'Harbour cottage with a hot tub'}
              error={titleTooLong ? `Shorten the title to ${TITLE_MAX} characters or fewer` : undefined}
            />
            {suggestion && !draft.title.trim() ? (
              <button
                type="button"
                onClick={() => update({ title: suggestion })}
                className="self-start rounded-full border border-hairline bg-paper px-3 py-1 text-left text-[13px] text-ink transition-colors hover:border-edge"
              >
                Use “{suggestion}”
              </button>
            ) : null}
          </div>
          <TextArea
            label="Description"
            value={draft.summary}
            onChange={(summary) => update({ summary })}
            max={SUMMARY_MAX}
            rows={6}
            placeholder="What is it like to stay here? The space, the light, what's close by."
            hint="The space, what guests can use and the neighbourhood each have their own part on its page."
          />
        </div>
      </>
    );
  } else if (current.id === 'pricing') {
    body = (
      <>
        <Question
          headingRef={heading}
          hint="Your usual price for a night. Each date's price is set on the calendar, or comes from PriceLabs."
        >
          What does a night cost?
        </Question>
        <div className="mt-8 grid gap-4 @md:grid-cols-2">
          <MoneyField
            label="Usual nightly price"
            value={draft.basePrice}
            onChange={(basePrice) => update({ basePrice })}
            symbol={symbol}
            error={prices.basePrice}
          />
          <MoneyField
            label="Cleaning fee"
            value={draft.cleaningFee}
            onChange={(cleaningFee) => update({ cleaningFee })}
            symbol={symbol}
            error={prices.cleaningFee}
            hint="Charged once a stay"
          />
        </div>
        <SubQuestion>Who sets the nightly price?</SubQuestion>
        <div role="radiogroup" aria-label="Who sets the price" className="mt-4 grid gap-3">
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
    const usual = usualPriceText(draft, currency, locale);
    const address = addressText(draft);
    const features = amenitiesText(draft.amenities, 3);
    body = (
      <>
        <Question headingRef={heading} hint="Change anything before you add it.">
          Does this look right?
        </Question>
        <div className="mt-8 xl:hidden">
          <ListingPreview
            draft={draft}
            currency={currency}
            locale={locale}
            coverUrl={photos[0]?.url}
            compact
          />
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
          <ReviewRow title="Amenities" onChange={() => go(STEP_INDEX.amenities)}>
            {features ?? <span className="text-mist">None picked yet</span>}
          </ReviewRow>
          <ReviewRow title="Photos" onChange={() => go(STEP_INDEX.photos)}>
            {photos.length ? (
              <span className="flex flex-col gap-2">
                <span className="flex gap-1.5">
                  {photos.slice(0, 5).map((photo, index) => (
                    <img
                      key={photo.id}
                      src={photo.url}
                      alt={index === 0 ? 'Cover photo' : ''}
                      className="h-11 w-14 rounded-md object-cover"
                    />
                  ))}
                </span>
                <span className="text-slate">
                  {plural(photos.length, 'photo')}
                  {photos.length < PHOTO_MIN_TO_LIST ? `, of the ${PHOTO_MIN_TO_LIST} Airbnb asks for` : ''}
                </span>
              </span>
            ) : (
              <span className="text-mist">None yet. Airbnb asks for at least {PHOTO_MIN_TO_LIST}.</span>
            )}
          </ReviewRow>
          <ReviewRow title="Title and description" onChange={() => go(STEP_INDEX.description)}>
            {draft.title.trim() ? (
              <>
                {draft.title.trim()}
                {draft.summary.trim() ? (
                  <>
                    <br />
                    <span className="line-clamp-2 text-slate">{draft.summary.trim()}</span>
                  </>
                ) : null}
              </>
            ) : (
              <span className="text-mist">No title yet</span>
            )}
          </ReviewRow>
          <ReviewRow title="Pricing" onChange={() => go(STEP_INDEX.pricing)}>
            {usual ?? priceOwnerText(draft)}
            {usual ? (
              <>
                <br />
                <span className="text-slate">{priceOwnerText(draft)}</span>
              </>
            ) : null}
            <br />
            {Object.keys(prices).length > 0 ? (
              <span className="text-urgent">The prices need fixing</span>
            ) : (
              <span className="text-slate">
                {limits
                  ? `Limits ${limits.charAt(0).toLowerCase()}${limits.slice(1)}`
                  : 'No price limits yet'}
              </span>
            )}
          </ReviewRow>
        </dl>
        {!draft.name.trim() ? (
          <div className="mt-6">
            <Notice>
              A property needs a name before it can be added.{' '}
              <button type="button" onClick={() => go(STEP_INDEX.name)} className="action">
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

  const addLabel = upload
    ? `Adding photos, ${upload.done + 1 > upload.total ? upload.total : upload.done + 1} of ${upload.total}`
    : add.isPending
      ? 'Adding'
      : 'Add property';

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the panel through onCancel; this only catches clicks on the dimmed page beside it
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
      onClick={(event) => {
        // A click on the dimmed page beside the panel closes it; the draft is kept.
        if (event.target === dialog.current && !busy) close();
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
              disabled={busy}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-hairline px-3 text-[13.5px] text-ink transition-colors hover:bg-linen disabled:opacity-50"
            >
              <IconX size={16} stroke={1.75} aria-hidden />
              Close
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[264px_minmax(0,1fr)] xl:grid-cols-[264px_minmax(0,1fr)_340px] 2xl:grid-cols-[264px_minmax(0,1fr)_380px]">
          {/* The spine: every step in its stage, with the answers so far. Any step is one click away. */}
          <nav
            aria-label="Steps"
            className="hidden min-h-0 flex-col overflow-y-auto border-r border-hairline bg-paper px-3 py-6 md:flex"
          >
            <ol>
              {STEPS.map((s, i) => {
                const done = isComplete(i);
                const here = i === step && !created;
                const stage = STAGES.find((g) => g.steps[0] === s.id);
                const summary = stepSummary(
                  s.id,
                  draft,
                  visited.includes(i) && furthest > i,
                  currency,
                  locale,
                  created ? created.photosAdded : photos.length,
                );
                // The line runs through every marker, and through each stage's name between them.
                const line = (filled: boolean, place: string) => (
                  <span
                    aria-hidden
                    className={cx(
                      'absolute left-6 w-px transition-colors duration-300',
                      filled ? 'bg-accent' : 'bg-hairline',
                      place,
                    )}
                  />
                );
                return (
                  <li key={s.id}>
                    {stage ? (
                      <p
                        className={cx(
                          'relative pr-2 pb-1.5 pl-[48px] text-[12px] text-mist',
                          i === 0 ? 'pt-0' : 'pt-5',
                        )}
                      >
                        {i > 0 ? line(isComplete(i - 1), 'inset-y-0') : null}
                        {stage.title}
                      </p>
                    ) : null}
                    <div className="relative">
                      {i > 0 ? line(isComplete(i - 1), 'top-0 h-6') : null}
                      {i < STEPS.length - 1 ? line(done, 'top-6 bottom-0') : null}
                      <button
                        type="button"
                        disabled={Boolean(created) || busy}
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
                            !done && !here && 'border border-edge bg-paper text-mist',
                          )}
                        >
                          {done && !here ? <IconCheck size={14} stroke={2.5} /> : i + 1}
                        </span>
                        <span className="min-w-0 pt-[3px]">
                          <span
                            className={cx('block text-[14px]', here ? 'font-medium text-ink' : 'text-ink')}
                          >
                            {s.title}
                            {done && !here ? <span className="sr-only">, done</span> : null}
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
                    </div>
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
                  <div className="flex gap-1" aria-hidden>
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
                  <button type="button" onClick={startOver} className="action">
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
            <ListingPreview
              draft={draft}
              currency={currency}
              locale={locale}
              coverUrl={photos[0]?.url ?? created?.property.photos[0]?.url}
            />
          </aside>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-hairline bg-canvas px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] md:px-6">
          {created ? (
            <>
              <button
                type="button"
                onClick={startOver}
                className="h-10 rounded-lg px-4 text-[14px] font-medium action action-ink"
              >
                Add another
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={close}
                  className="h-10 rounded-lg border border-hairline px-4 text-[14px] font-medium text-ink transition-colors hover:bg-linen"
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={() => navigate(`/properties/${created.property.id}`)}
                  className="h-10 rounded-lg bg-ink px-5 text-[14px] font-medium text-canvas transition-colors hover:bg-ink/88"
                >
                  Open its page
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => go(Math.max(0, step - 1))}
                disabled={busy}
                className={cx(
                  'h-10 rounded-lg px-4 text-[14px] font-medium action action-ink disabled:opacity-50',
                  step === 0 && 'invisible',
                )}
              >
                Back
              </button>
              <button
                type="submit"
                form={formId}
                disabled={busy}
                className="h-10 rounded-lg bg-ink px-6 text-[14px] font-medium text-canvas transition-colors hover:bg-ink/88 disabled:opacity-60"
              >
                {isLast ? addLabel : 'Continue'}
              </button>
            </>
          )}
        </footer>
      </div>
    </dialog>
  );
}
