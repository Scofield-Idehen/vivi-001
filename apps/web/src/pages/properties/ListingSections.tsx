import { IconReceiptRefund } from '@tabler/icons-react';
import {
  CANCELLATION_POLICIES,
  CANCELLATION_POLICY_LABELS,
  type CancellationPolicy,
  CHECK_IN_METHOD_LABELS,
  CHECK_IN_METHODS,
  type CheckInMethod,
  PRICE_OWNERS,
  PROPERTY_TYPE_LABELS,
  PROPERTY_TYPES,
  type PriceOwner,
  type PropertyDetail,
  type PropertyType,
  type PropertyUpdate,
  SECTION_MAX,
  SPACE_TYPE_LABELS,
  SPACE_TYPES,
  type SpaceType,
  SUMMARY_MAX,
  TITLE_MAX,
} from '@v01/shared';
import type { ReactNode } from 'react';
import { OptionRow, Stepper } from '../../components/choices.tsx';
import {
  CopyButton,
  MoneyField,
  SelectField,
  TextArea,
  TextField,
  Toggle,
} from '../../components/fields.tsx';
import { plural, V01 } from '../../lib/format.ts';
import { countryOptions, priceToMinor, TIMES } from './draft.ts';
import { CHECK_IN_ICONS, PRICE_OWNER_ICONS } from './icons.ts';
import { currencySymbol, minorToInput, moneyText, ordinal } from './money.ts';
import { Facts, InvalidDraft, Missing, Section, SectionForm, useEditor } from './Section.tsx';

export interface SectionProps {
  d: PropertyDetail;
  canEdit: boolean;
  save(changes: PropertyUpdate): Promise<unknown>;
  currency: string;
  locale: string;
}

const text = (value: string | null) => value ?? '';
const timeOptions = TIMES.map((t) => ({ value: t, label: t }));

function bathroomsText(n: number): string {
  const shown = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(n);
  return `${shown} ${n === 1 ? 'bathroom' : 'bathrooms'}`;
}

// The place ------------------------------------------------------------------------------------

export function PlaceSection({ d, canEdit, save }: SectionProps) {
  const fromRooms = d.rooms.length > 0;
  const editor = useEditor(
    () => ({
      propertyType: (d.propertyType ?? 'house') as PropertyType,
      spaceType: d.spaceType,
      maxGuests: d.maxGuests,
      bedrooms: d.bedrooms ?? 1,
      beds: d.beds ?? 1,
      bathrooms: d.bathrooms ?? 1,
    }),
    (draft) =>
      save(
        fromRooms
          ? {
              propertyType: draft.propertyType,
              spaceType: draft.spaceType,
              maxGuests: draft.maxGuests,
              bathrooms: draft.bathrooms,
            }
          : draft,
      ),
  );
  const draft = editor.draft;
  return (
    <Section id="place" canEdit={canEdit} editor={editor} description="The basics every channel shows first.">
      {draft ? (
        <SectionForm editor={editor}>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField<PropertyType>
              label="Kind of place"
              value={draft.propertyType}
              onChange={(propertyType) => editor.set({ propertyType })}
              options={PROPERTY_TYPES.map((t) => ({ value: t, label: PROPERTY_TYPE_LABELS[t] }))}
            />
            <SelectField<SpaceType>
              label="What guests have"
              value={draft.spaceType}
              onChange={(spaceType) => editor.set({ spaceType })}
              options={SPACE_TYPES.map((t) => ({ value: t, label: SPACE_TYPE_LABELS[t] }))}
            />
          </div>
          <div className="divide-y divide-hairline border-y border-hairline">
            <Stepper
              label="Guests"
              value={draft.maxGuests}
              min={1}
              max={50}
              onChange={(maxGuests) => editor.set({ maxGuests })}
            />
            {fromRooms ? null : (
              <>
                <Stepper
                  label="Bedrooms"
                  hint="0 for a studio"
                  value={draft.bedrooms}
                  min={0}
                  max={50}
                  onChange={(bedrooms) => editor.set({ bedrooms })}
                />
                <Stepper
                  label="Beds"
                  value={draft.beds}
                  min={1}
                  max={50}
                  onChange={(beds) => editor.set({ beds })}
                />
              </>
            )}
            <Stepper
              label="Bathrooms"
              hint="One with only a toilet and basin counts as a half"
              value={draft.bathrooms}
              min={0}
              max={20}
              step={0.5}
              onChange={(bathrooms) => editor.set({ bathrooms })}
            />
          </div>
          {fromRooms ? (
            <p className="text-[13px] text-mist">Bedrooms and beds are counted from Rooms and beds.</p>
          ) : null}
        </SectionForm>
      ) : (
        <Facts
          items={[
            {
              label: 'Kind of place',
              value: d.propertyType ? (
                `${PROPERTY_TYPE_LABELS[d.propertyType]}, ${SPACE_TYPE_LABELS[d.spaceType].toLowerCase()}`
              ) : (
                <Missing>Not chosen yet</Missing>
              ),
            },
            { label: 'Guests', value: `Up to ${plural(d.maxGuests, 'guest')}` },
            {
              label: 'Rooms',
              value: [
                d.bedrooms === null ? null : plural(d.bedrooms, 'bedroom'),
                d.beds === null ? null : plural(d.beds, 'bed'),
                d.bathrooms === null ? null : bathroomsText(d.bathrooms),
              ]
                .filter(Boolean)
                .join(', '),
            },
          ]}
        />
      )}
    </Section>
  );
}

// Title and description ------------------------------------------------------------------------

const DETAIL_FIELDS = [
  { key: 'theSpace', label: 'The space', hint: 'Rooms, layout and anything special about them.' },
  {
    key: 'guestAccess',
    label: 'Guest access',
    hint: 'What guests can use, and anything that is off limits.',
  },
  { key: 'neighbourhood', label: 'The neighbourhood', hint: 'What is nearby and what the area is like.' },
  { key: 'gettingAround', label: 'Getting around', hint: 'Parking, trains, buses and walking times.' },
  {
    key: 'otherNotes',
    label: 'Other things to note',
    hint: 'Stairs, noise, pets on site, anything guests should know.',
  },
] as const;

type DetailKey = (typeof DETAIL_FIELDS)[number]['key'];

export function DescriptionSection({ d, canEdit, save }: SectionProps) {
  const editor = useEditor(
    () => ({
      title: text(d.title),
      summary: text(d.summary),
      theSpace: text(d.theSpace),
      guestAccess: text(d.guestAccess),
      neighbourhood: text(d.neighbourhood),
      gettingAround: text(d.gettingAround),
      otherNotes: text(d.otherNotes),
    }),
    (draft) => {
      if (draft.title.trim().length > TITLE_MAX)
        throw new InvalidDraft(`Keep the title to ${TITLE_MAX} characters.`);
      if (draft.summary.trim().length > SUMMARY_MAX) {
        throw new InvalidDraft(`Keep the description to ${SUMMARY_MAX} characters.`);
      }
      return save(draft);
    },
  );
  const draft = editor.draft;
  const written = DETAIL_FIELDS.filter((f) => d[f.key]);

  return (
    <Section
      id="description"
      canEdit={canEdit}
      editor={editor}
      description="Write it once here. Copy any part into a channel's own editor."
    >
      {draft ? (
        <SectionForm editor={editor}>
          <TextField
            label="Title"
            value={draft.title}
            onChange={(title) => editor.set({ title })}
            max={TITLE_MAX}
            placeholder="Seaside house with a garden and hot tub"
            hint="What guests see first in search. Airbnb cuts anything longer."
          />
          <TextArea
            label="Description"
            value={draft.summary}
            onChange={(summary) => editor.set({ summary })}
            max={SUMMARY_MAX}
            rows={5}
            hint="A few lines on what makes it a good stay. The sections below take the detail."
          />
          {DETAIL_FIELDS.map((field) => (
            <TextArea
              key={field.key}
              label={field.label}
              value={draft[field.key as DetailKey]}
              onChange={(value) => editor.set({ [field.key]: value } as Partial<typeof draft>)}
              max={SECTION_MAX}
              rows={3}
              hint={field.hint}
            />
          ))}
        </SectionForm>
      ) : (
        <div className="flex flex-col gap-6">
          <div>
            <div className="flex items-start justify-between gap-4">
              <p
                className={
                  d.title
                    ? 'font-semibold tracking-[-0.015em] text-[18px] leading-snug text-ink'
                    : 'text-[14.5px] text-mist'
                }
              >
                {d.title ?? 'No title yet'}
              </p>
              {d.title ? <CopyButton text={d.title} /> : null}
            </div>
            <div className="mt-2 flex items-start justify-between gap-4">
              <p className="max-w-[64ch] whitespace-pre-line text-[14.5px] leading-relaxed text-slate">
                {d.summary ?? <Missing>No description yet</Missing>}
              </p>
              {d.summary ? <CopyButton text={d.summary} /> : null}
            </div>
          </div>
          {written.length ? (
            <dl className="divide-y divide-hairline border-y border-hairline">
              {written.map((field) => (
                <div key={field.key} className="py-4">
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-[13.5px] font-medium text-ink">{field.label}</dt>
                    <CopyButton text={d[field.key] ?? ''} />
                  </div>
                  <dd className="mt-1 max-w-[64ch] whitespace-pre-line text-[14px] leading-relaxed text-slate">
                    {d[field.key]}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-[13.5px] text-mist">
              The space, guest access, the neighbourhood, getting around and other notes can be added too.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

// Address --------------------------------------------------------------------------------------

export function AddressSection({ d, canEdit, save }: SectionProps) {
  const editor = useEditor(
    () => ({
      addressLine1: text(d.addressLine1),
      addressLine2: text(d.addressLine2),
      city: text(d.city),
      postcode: text(d.postcode),
      area: text(d.area),
      countryCode: d.countryCode,
    }),
    (draft) => save(draft),
  );
  const draft = editor.draft;
  const country = new Intl.DisplayNames(['en-GB'], { type: 'region' }).of(d.countryCode) ?? d.countryCode;
  const lines = [d.addressLine1, d.addressLine2, d.city, d.postcode].filter(Boolean);
  return (
    <Section
      id="address"
      canEdit={canEdit}
      editor={editor}
      description="Guests get the exact address once they book; channels show the area before that."
    >
      {draft ? (
        <SectionForm editor={editor}>
          <TextField
            label="Street address"
            value={draft.addressLine1}
            onChange={(addressLine1) => editor.set({ addressLine1 })}
            autoComplete="address-line1"
          />
          <TextField
            label="Address line 2"
            value={draft.addressLine2}
            onChange={(addressLine2) => editor.set({ addressLine2 })}
            autoComplete="address-line2"
          />
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_170px]">
            <TextField
              label="Town or city"
              value={draft.city}
              onChange={(city) => editor.set({ city })}
              autoComplete="address-level2"
            />
            <TextField
              label="Postcode"
              value={draft.postcode}
              onChange={(postcode) => editor.set({ postcode: postcode.toUpperCase() })}
              autoComplete="postal-code"
            />
          </div>
          <TextField
            label="Area"
            value={draft.area}
            onChange={(area) => editor.set({ area })}
            hint="A neighbourhood or district. Reports and the calendar group properties by area."
          />
          <SelectField
            label="Country"
            value={draft.countryCode}
            onChange={(countryCode) => editor.set({ countryCode })}
            options={countryOptions(d.countryCode).map((c) => ({ value: c.code, label: c.name }))}
          />
        </SectionForm>
      ) : (
        <Facts
          items={[
            { label: 'Address', value: lines.length ? lines.join(', ') : <Missing>Not added yet</Missing> },
            { label: 'Area', value: d.area ?? <Missing>Not added yet</Missing> },
            { label: 'Country', value: country },
          ]}
        />
      )}
    </Section>
  );
}

// Arriving -------------------------------------------------------------------------------------

export function ArrivalSection({ d, canEdit, save }: SectionProps) {
  const editor = useEditor(
    () => ({
      checkInMethod: d.checkInMethod as CheckInMethod | null,
      checkInTime: d.checkInTime,
      checkOutTime: d.checkOutTime,
    }),
    (draft) => save(draft),
  );
  const draft = editor.draft;
  return (
    <Section id="arrival" canEdit={canEdit} editor={editor} description="How guests get in, and when.">
      {draft ? (
        <SectionForm editor={editor}>
          <div role="radiogroup" aria-label="How guests get in" className="grid gap-3">
            {CHECK_IN_METHODS.map((method) => (
              <OptionRow
                key={method}
                name="checkInMethod"
                value={method}
                checked={draft.checkInMethod === method}
                onSelect={(value) => editor.set({ checkInMethod: value as CheckInMethod })}
                icon={CHECK_IN_ICONS[method]}
                label={CHECK_IN_METHOD_LABELS[method]}
                description={CHECK_IN_NOTES[method]}
              />
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Check-in from"
              value={draft.checkInTime}
              onChange={(checkInTime) => editor.set({ checkInTime })}
              options={timeOptions}
            />
            <SelectField
              label="Check-out by"
              value={draft.checkOutTime}
              onChange={(checkOutTime) => editor.set({ checkOutTime })}
              options={timeOptions}
            />
          </div>
        </SectionForm>
      ) : (
        <Facts
          items={[
            {
              label: 'Getting in',
              value: d.checkInMethod ? (
                CHECK_IN_METHOD_LABELS[d.checkInMethod]
              ) : (
                <Missing>Not chosen yet</Missing>
              ),
            },
            { label: 'Check-in', value: `From ${d.checkInTime}` },
            { label: 'Check-out', value: `By ${d.checkOutTime}` },
          ]}
        />
      )}
    </Section>
  );
}

const CHECK_IN_NOTES: Record<CheckInMethod, string> = {
  smart_lock: 'Guests open it with an app or a code sent before arrival.',
  keypad: 'Guests type a code at the door.',
  lockbox: 'A key waits in a box with a code.',
  host_greets: 'Someone hands over the keys in person.',
  building_staff: 'A concierge or reception has the keys.',
};

// House rules ----------------------------------------------------------------------------------

export function RulesSection({ d, canEdit, save }: SectionProps) {
  const editor = useEditor(
    () => ({
      petsAllowed: d.petsAllowed,
      smokingAllowed: d.smokingAllowed,
      eventsAllowed: d.eventsAllowed,
      childrenAllowed: d.childrenAllowed,
      quietHours: d.quietHoursStart !== null,
      quietHoursStart: d.quietHoursStart ?? '22:00',
      quietHoursEnd: d.quietHoursEnd ?? '08:00',
      houseRules: text(d.houseRules),
    }),
    ({ quietHours, ...draft }) =>
      save({
        ...draft,
        quietHoursStart: quietHours ? draft.quietHoursStart : null,
        quietHoursEnd: quietHours ? draft.quietHoursEnd : null,
      }),
  );
  const draft = editor.draft;
  const rules = [
    d.petsAllowed ? 'Pets allowed' : 'No pets',
    d.smokingAllowed ? 'Smoking allowed' : 'No smoking',
    d.eventsAllowed ? 'Events allowed' : 'No parties or events',
    d.childrenAllowed ? 'Children welcome' : 'Not suitable for children',
  ];
  return (
    <Section
      id="rules"
      canEdit={canEdit}
      editor={editor}
      description="Airbnb takes these straight from here once the property is connected."
    >
      {draft ? (
        <SectionForm editor={editor}>
          <div className="divide-y divide-hairline border-y border-hairline">
            <Toggle
              label="Pets allowed"
              checked={draft.petsAllowed}
              onChange={(petsAllowed) => editor.set({ petsAllowed })}
            />
            <Toggle
              label="Smoking allowed"
              checked={draft.smokingAllowed}
              onChange={(smokingAllowed) => editor.set({ smokingAllowed })}
            />
            <Toggle
              label="Events allowed"
              description="Parties, weddings and other gatherings."
              checked={draft.eventsAllowed}
              onChange={(eventsAllowed) => editor.set({ eventsAllowed })}
            />
            <Toggle
              label="Suitable for children"
              checked={draft.childrenAllowed}
              onChange={(childrenAllowed) => editor.set({ childrenAllowed })}
            />
            <Toggle
              label="Quiet hours"
              checked={draft.quietHours}
              onChange={(quietHours) => editor.set({ quietHours })}
            />
          </div>
          {draft.quietHours ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Quiet from"
                value={draft.quietHoursStart}
                onChange={(quietHoursStart) => editor.set({ quietHoursStart })}
                options={timeOptions}
              />
              <SelectField
                label="Until"
                value={draft.quietHoursEnd}
                onChange={(quietHoursEnd) => editor.set({ quietHoursEnd })}
                options={timeOptions}
              />
            </div>
          ) : null}
          <TextArea
            label="Other rules"
            value={draft.houseRules}
            onChange={(houseRules) => editor.set({ houseRules })}
            max={SECTION_MAX}
            rows={3}
            hint="Anything else, like shoes off indoors or no use of the hot tub after 22:00."
          />
        </SectionForm>
      ) : (
        <div className="flex flex-col gap-3">
          <ul className="flex flex-wrap gap-2">
            {rules.map((rule) => (
              <li key={rule} className="rounded-full border border-hairline px-3 py-1 text-[13.5px] text-ink">
                {rule}
              </li>
            ))}
            {d.quietHoursStart ? (
              <li className="rounded-full border border-hairline px-3 py-1 text-[13.5px] text-ink">
                Quiet hours {d.quietHoursStart} to {d.quietHoursEnd}
              </li>
            ) : null}
          </ul>
          {d.houseRules ? (
            <p className="max-w-[64ch] whitespace-pre-line text-[14px] leading-relaxed text-slate">
              {d.houseRules}
            </p>
          ) : null}
        </div>
      )}
    </Section>
  );
}

// Booking rules --------------------------------------------------------------------------------

const NOTICE_OPTIONS = [
  { value: '0', label: 'Same day' },
  { value: '24', label: 'At least 1 day before' },
  { value: '48', label: 'At least 2 days before' },
  { value: '72', label: 'At least 3 days before' },
  { value: '168', label: 'At least 7 days before' },
] as const;

const WINDOW_OPTIONS = [
  { value: '90', label: '3 months ahead' },
  { value: '180', label: '6 months ahead' },
  { value: '270', label: '9 months ahead' },
  { value: '365', label: '12 months ahead' },
  { value: '730', label: '24 months ahead' },
  { value: 'any', label: 'Any time' },
] as const;

const PREPARATION_OPTIONS = [
  { value: '0', label: 'None' },
  { value: '1', label: '1 night before and after each stay' },
  { value: '2', label: '2 nights before and after each stay' },
] as const;

const MAX_NIGHTS_OPTIONS = [
  { value: 'none', label: 'No maximum' },
  ...[7, 14, 21, 28, 30, 60, 90, 180, 365].map((n) => ({ value: String(n), label: plural(n, 'night') })),
];

function labelFor(options: readonly { value: string; label: string }[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

export function BookingSection({ d, canEdit, save }: SectionProps) {
  const editor = useEditor(
    () => ({
      instantBook: d.instantBook,
      minNights: d.minNights,
      maxNights: d.maxNights === null ? 'none' : String(d.maxNights),
      advanceNoticeHours: String(d.advanceNoticeHours),
      bookingWindowDays: d.bookingWindowDays === null ? 'any' : String(d.bookingWindowDays),
      preparationDays: String(d.preparationDays),
      cancellationPolicy: d.cancellationPolicy,
    }),
    (draft) => {
      const maxNights = draft.maxNights === 'none' ? null : Number(draft.maxNights);
      if (maxNights !== null && maxNights < draft.minNights) {
        throw new InvalidDraft('The shortest stay is longer than the longest.');
      }
      return save({
        instantBook: draft.instantBook,
        minNights: draft.minNights,
        maxNights,
        advanceNoticeHours: Number(draft.advanceNoticeHours),
        bookingWindowDays: draft.bookingWindowDays === 'any' ? null : Number(draft.bookingWindowDays),
        preparationDays: Number(draft.preparationDays),
        cancellationPolicy: draft.cancellationPolicy,
      });
    },
  );
  const draft = editor.draft;
  const policy = CANCELLATION_POLICY_LABELS[d.cancellationPolicy];
  // A saved value outside the usual choices still shows, as itself.
  const maxOptions =
    draft && !MAX_NIGHTS_OPTIONS.some((o) => o.value === draft.maxNights)
      ? [...MAX_NIGHTS_OPTIONS, { value: draft.maxNights, label: plural(Number(draft.maxNights), 'night') }]
      : MAX_NIGHTS_OPTIONS;

  return (
    <Section
      id="booking"
      canEdit={canEdit}
      editor={editor}
      description="Who can book, for how long and how far ahead. Stay lengths reach every channel."
    >
      {draft ? (
        <SectionForm editor={editor}>
          <div className="divide-y divide-hairline border-y border-hairline">
            <Toggle
              label="Instant book"
              description="Guests book without asking first. Turn it off to approve each request."
              checked={draft.instantBook}
              onChange={(instantBook) => editor.set({ instantBook })}
            />
            <Stepper
              label="Shortest stay"
              hint="In nights"
              value={draft.minNights}
              min={1}
              max={365}
              onChange={(minNights) => editor.set({ minNights })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Longest stay"
              value={draft.maxNights}
              onChange={(maxNights) => editor.set({ maxNights })}
              options={maxOptions}
            />
            <SelectField
              label="Advance notice"
              value={draft.advanceNoticeHours}
              onChange={(advanceNoticeHours) => editor.set({ advanceNoticeHours })}
              options={NOTICE_OPTIONS}
            />
            <SelectField
              label="How far ahead guests can book"
              value={draft.bookingWindowDays}
              onChange={(bookingWindowDays) => editor.set({ bookingWindowDays })}
              options={WINDOW_OPTIONS}
            />
            <SelectField
              label="Preparation time"
              value={draft.preparationDays}
              onChange={(preparationDays) => editor.set({ preparationDays })}
              options={PREPARATION_OPTIONS}
              hint="Nights kept free around each stay for cleaning or repairs."
            />
          </div>
          <div>
            <p className="mb-3 text-[13px] text-slate">Cancellation policy</p>
            <div role="radiogroup" aria-label="Cancellation policy" className="grid gap-3">
              {CANCELLATION_POLICIES.map((key) => (
                <OptionRow
                  key={key}
                  name="cancellationPolicy"
                  value={key}
                  checked={draft.cancellationPolicy === key}
                  onSelect={(value) => editor.set({ cancellationPolicy: value as CancellationPolicy })}
                  icon={IconReceiptRefund}
                  label={CANCELLATION_POLICY_LABELS[key].label}
                  description={CANCELLATION_POLICY_LABELS[key].description}
                />
              ))}
            </div>
            <p className="mt-2 text-[12.5px] text-mist">Each channel applies its nearest policy.</p>
          </div>
        </SectionForm>
      ) : (
        <Facts
          items={[
            {
              label: 'Instant book',
              value: d.instantBook ? 'On: guests book without asking' : 'Off: each request is approved',
            },
            {
              label: 'Stay length',
              value:
                d.maxNights === null
                  ? `At least ${plural(d.minNights, 'night')}`
                  : `${d.minNights} to ${plural(d.maxNights, 'night')}`,
            },
            { label: 'Advance notice', value: labelFor(NOTICE_OPTIONS, String(d.advanceNoticeHours)) },
            {
              label: 'Booking window',
              value:
                d.bookingWindowDays === null
                  ? 'Any time'
                  : labelFor(WINDOW_OPTIONS, String(d.bookingWindowDays)) === String(d.bookingWindowDays)
                    ? `${d.bookingWindowDays} days ahead`
                    : labelFor(WINDOW_OPTIONS, String(d.bookingWindowDays)),
            },
            { label: 'Preparation time', value: labelFor(PREPARATION_OPTIONS, String(d.preparationDays)) },
            { label: 'Cancellation', value: `${policy.label}. ${policy.description}` },
          ]}
        />
      )}
    </Section>
  );
}

// Prices and fees ------------------------------------------------------------------------------

export function PricingSection({ d, canEdit, save, currency, locale }: SectionProps) {
  const money = (minor: number | null) => minorToInput(minor, currency);
  const editor = useEditor(
    () => ({
      priceOwner: d.priceOwner,
      basePrice: money(d.basePriceMinor),
      weekendPrice: money(d.weekendPriceMinor),
      cleaningFee: money(d.cleaningFeeMinor),
      extraGuestFee: money(d.extraGuestFeeMinor),
      extraGuestFrom: d.extraGuestFrom ?? Math.max(1, d.maxGuests - 1),
      securityDeposit: money(d.securityDepositMinor),
      minPrice: money(d.minPriceMinor),
      maxPrice: money(d.maxPriceMinor),
    }),
    (draft) => {
      const read = (label: string, value: string): number | null => {
        const parsed = priceToMinor(value, currency);
        if (parsed.error) throw new InvalidDraft(`${label}: ${parsed.error.toLowerCase()}.`);
        return parsed.minor ?? null;
      };
      const minPriceMinor = read('Lowest price', draft.minPrice);
      const maxPriceMinor = read('Highest price', draft.maxPrice);
      if (minPriceMinor && maxPriceMinor && minPriceMinor > maxPriceMinor) {
        throw new InvalidDraft('The lowest price is above the highest.');
      }
      const extraGuestFeeMinor = read('Extra guest fee', draft.extraGuestFee);
      return save({
        priceOwner: draft.priceOwner,
        basePriceMinor: read('Nightly price', draft.basePrice),
        weekendPriceMinor: read('Weekend price', draft.weekendPrice),
        cleaningFeeMinor: read('Cleaning fee', draft.cleaningFee),
        extraGuestFeeMinor,
        extraGuestFrom: extraGuestFeeMinor ? draft.extraGuestFrom : null,
        securityDepositMinor: read('Security deposit', draft.securityDeposit),
        minPriceMinor,
        maxPriceMinor,
      });
    },
  );
  const draft = editor.draft;
  const symbol = currencySymbol(currency, locale);
  const shown = (minor: number | null, none: ReactNode = <Missing>None</Missing>) =>
    minor ? moneyText(minor, currency, locale) : none;

  return (
    <Section
      id="pricing"
      canEdit={canEdit}
      editor={editor}
      description="Nightly prices and limits reach every channel. Airbnb also takes the fees from here."
    >
      {draft ? (
        <SectionForm editor={editor}>
          <div role="radiogroup" aria-label="Who sets the nightly price" className="grid gap-3">
            {PRICE_OWNERS.map((owner) => (
              <OptionRow
                key={owner}
                name="priceOwner"
                value={owner}
                checked={draft.priceOwner === owner}
                onSelect={(value) => editor.set({ priceOwner: value as PriceOwner })}
                icon={PRICE_OWNER_ICONS[owner]}
                label={owner === 'v01' ? `You, in ${V01}` : 'PriceLabs'}
                description={
                  owner === 'v01'
                    ? `Set nightly prices on ${V01}'s calendar.`
                    : "Prices come in from PriceLabs once it's connected."
                }
              />
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <MoneyField
              label="Usual nightly price"
              value={draft.basePrice}
              onChange={(basePrice) => editor.set({ basePrice })}
              symbol={symbol}
              hint={
                draft.priceOwner === 'pricelabs'
                  ? 'PriceLabs sets each night; this is the fallback.'
                  : undefined
              }
            />
            <MoneyField
              label="Weekend nightly price"
              value={draft.weekendPrice}
              onChange={(weekendPrice) => editor.set({ weekendPrice })}
              symbol={symbol}
              hint="Friday and Saturday nights"
            />
            <MoneyField
              label="Cleaning fee"
              value={draft.cleaningFee}
              onChange={(cleaningFee) => editor.set({ cleaningFee })}
              symbol={symbol}
              hint="Once per stay"
            />
            <MoneyField
              label="Security deposit"
              value={draft.securityDeposit}
              onChange={(securityDeposit) => editor.set({ securityDeposit })}
              symbol={symbol}
            />
            <MoneyField
              label="Extra guest fee"
              value={draft.extraGuestFee}
              onChange={(extraGuestFee) => editor.set({ extraGuestFee })}
              symbol={symbol}
              hint="Per guest, per night"
            />
            <SelectField
              label="Charged from the"
              value={String(draft.extraGuestFrom)}
              onChange={(value) => editor.set({ extraGuestFrom: Number(value) })}
              options={Array.from({ length: Math.max(1, d.maxGuests) }, (_, i) => ({
                value: String(i + 1),
                label: `${ordinal(i + 1)} guest`,
              }))}
            />
          </div>
          <div>
            <p className="text-[13px] text-slate">Price limits</p>
            <p className="mt-1 max-w-[56ch] text-[12.5px] leading-snug text-mist">
              A nightly price outside these never reaches Airbnb, Booking.com or Vrbo, whoever set it.
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <MoneyField
                label="Lowest nightly price"
                value={draft.minPrice}
                onChange={(minPrice) => editor.set({ minPrice })}
                symbol={symbol}
              />
              <MoneyField
                label="Highest nightly price"
                value={draft.maxPrice}
                onChange={(maxPrice) => editor.set({ maxPrice })}
                symbol={symbol}
              />
            </div>
          </div>
        </SectionForm>
      ) : (
        <Facts
          items={[
            {
              label: 'Nightly price',
              value:
                d.priceOwner === 'pricelabs' ? (
                  'Set each night by PriceLabs'
                ) : d.basePriceMinor ? (
                  `${moneyText(d.basePriceMinor, currency, locale)} a night${
                    d.weekendPriceMinor
                      ? `, ${moneyText(d.weekendPriceMinor, currency, locale)} on Fridays and Saturdays`
                      : ''
                  }`
                ) : (
                  <Missing>Not set yet</Missing>
                ),
            },
            { label: 'Cleaning fee', value: shown(d.cleaningFeeMinor) },
            {
              label: 'Extra guests',
              value:
                d.extraGuestFeeMinor && d.extraGuestFrom ? (
                  `${moneyText(d.extraGuestFeeMinor, currency, locale)} a night for each guest from the ${ordinal(d.extraGuestFrom)}`
                ) : (
                  <Missing>No charge</Missing>
                ),
            },
            { label: 'Security deposit', value: shown(d.securityDepositMinor) },
            {
              label: 'Price limits',
              value:
                d.minPriceMinor || d.maxPriceMinor ? (
                  [
                    d.minPriceMinor ? `From ${moneyText(d.minPriceMinor, currency, locale)}` : null,
                    d.maxPriceMinor ? `up to ${moneyText(d.maxPriceMinor, currency, locale)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' ')
                ) : (
                  <Missing>None yet</Missing>
                ),
            },
          ]}
        />
      )}
    </Section>
  );
}

// Licence --------------------------------------------------------------------------------------

export function LicenceSection({ d, canEdit, save }: SectionProps) {
  const editor = useEditor(
    () => ({ licenceNumber: text(d.licenceNumber) }),
    (draft) => save(draft),
  );
  const draft = editor.draft;
  return (
    <Section
      id="licence"
      canEdit={canEdit}
      editor={editor}
      description="Some places, Scotland among them, need a short-term let licence or registration number on every listing."
    >
      {draft ? (
        <SectionForm editor={editor}>
          <TextField
            label="Licence or registration number"
            value={draft.licenceNumber}
            onChange={(licenceNumber) => editor.set({ licenceNumber: licenceNumber.toUpperCase() })}
          />
        </SectionForm>
      ) : (
        <div className="flex items-center justify-between gap-4">
          {d.licenceNumber ? (
            <p className="font-mono text-[14.5px] text-ink">{d.licenceNumber}</p>
          ) : (
            <p className="text-[14.5px]">
              <Missing>None added</Missing>
            </p>
          )}
          {d.licenceNumber ? <CopyButton text={d.licenceNumber} /> : null}
        </div>
      )}
    </Section>
  );
}
