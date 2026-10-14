import { IconCheck, IconSearch } from '@tabler/icons-react';
import {
  AMENITIES,
  AMENITY_CATEGORIES,
  AMENITY_CATEGORY_LABELS,
  type Amenity,
  amenity,
  type PropertyDetail,
} from '@v01/shared';
import { useId, useState } from 'react';
import { useSetAmenities } from '../../lib/api.ts';
import { STANDOUT_ICONS } from './icons.ts';
import { Missing, Section, SectionForm, useEditor } from './Section.tsx';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

const STANDOUT = AMENITIES.filter((a) => a.category === 'standout');

/** A standout feature as a tile with its picture; checked ones are outlined in ink. */
function StandoutTile({ item, checked, onToggle }: { item: Amenity; checked: boolean; onToggle(): void }) {
  const Icon = STANDOUT_ICONS[item.code];
  return (
    <label
      className={cx(
        'relative flex min-h-[88px] cursor-pointer flex-col justify-between gap-3 rounded-xl border bg-canvas p-3.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
        checked
          ? 'border-ink shadow-[inset_0_0_0_1px_var(--color-ink)]'
          : 'border-hairline hover:border-edge',
      )}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} className="sr-only" />
      {Icon ? (
        <Icon size={24} stroke={1.4} aria-hidden className={checked ? 'text-ink' : 'text-slate'} />
      ) : null}
      <span className="text-[13.5px] leading-tight font-medium text-ink">{item.label}</span>
      {checked ? (
        <span
          aria-hidden
          className="absolute top-2.5 right-2.5 grid size-5 place-items-center rounded-full bg-ink"
        >
          <IconCheck size={12} stroke={2.5} className="text-canvas" />
        </span>
      ) : null}
    </label>
  );
}

function Check({ item, checked, onToggle }: { item: Amenity; checked: boolean; onToggle(): void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 py-1.5 text-[14px] text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="size-4 accent-[var(--color-ink)]"
      />
      {item.label}
    </label>
  );
}

export function AmenitiesSection({
  d,
  canEdit,
  orgId,
}: {
  d: PropertyDetail;
  canEdit: boolean;
  orgId: string;
}) {
  const setAmenities = useSetAmenities(orgId, d.id);
  const editor = useEditor(
    () => ({ codes: new Set(d.amenities) }),
    (draft) => setAmenities.mutateAsync([...draft.codes]),
  );
  const [filter, setFilter] = useState('');
  const filterId = useId();
  const draft = editor.draft;

  const toggle = (code: string) => {
    if (!draft) return;
    const codes = new Set(draft.codes);
    if (codes.has(code)) codes.delete(code);
    else codes.add(code);
    editor.set({ codes });
  };

  const picked = d.amenities.map(amenity).filter((a): a is Amenity => Boolean(a));
  const pickedStandout = picked.filter((a) => a.category === 'standout');
  const query = filter.trim().toLowerCase();
  const matches = (a: Amenity) => !query || a.label.toLowerCase().includes(query);

  return (
    <Section
      id="amenities"
      canEdit={canEdit}
      editor={editor}
      description="Guests filter searches by these. Standout features are what make a listing stand out, so they come first."
    >
      {draft ? (
        <SectionForm editor={editor}>
          <div className="relative max-w-[360px]">
            <label htmlFor={filterId} className="sr-only">
              Find an amenity
            </label>
            <IconSearch
              size={16}
              stroke={1.75}
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-mist"
            />
            <input
              id={filterId}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Find an amenity"
              className="h-9 w-full rounded-md border border-edge bg-white pr-3 pl-9 text-[14px] text-ink placeholder:text-mist focus:border-accent focus:outline-none"
            />
          </div>
          {STANDOUT.some(matches) ? (
            <fieldset>
              <legend className="mb-3 text-[14.5px] font-medium text-ink">
                {AMENITY_CATEGORY_LABELS.standout}
              </legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {STANDOUT.filter(matches).map((item) => (
                  <StandoutTile
                    key={item.code}
                    item={item}
                    checked={draft.codes.has(item.code)}
                    onToggle={() => toggle(item.code)}
                  />
                ))}
              </div>
            </fieldset>
          ) : null}
          <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
            {AMENITY_CATEGORIES.filter((c) => c !== 'standout').map((category) => {
              const items = AMENITIES.filter((a) => a.category === category && matches(a));
              if (!items.length) return null;
              return (
                <fieldset key={category}>
                  <legend className="mb-1.5 text-[14.5px] font-medium text-ink">
                    {AMENITY_CATEGORY_LABELS[category]}
                  </legend>
                  {items.map((item) => (
                    <Check
                      key={item.code}
                      item={item}
                      checked={draft.codes.has(item.code)}
                      onToggle={() => toggle(item.code)}
                    />
                  ))}
                </fieldset>
              );
            })}
          </div>
          <p className="text-[13px] text-mist">{draft.codes.size} picked</p>
        </SectionForm>
      ) : picked.length ? (
        <div className="flex flex-col gap-6">
          {pickedStandout.length ? (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {pickedStandout.map((item) => {
                const Icon = STANDOUT_ICONS[item.code];
                return (
                  <li key={item.code} className="flex items-center gap-3 rounded-xl bg-paper px-3.5 py-3">
                    {Icon ? <Icon size={22} stroke={1.4} aria-hidden className="shrink-0 text-ink" /> : null}
                    <span className="text-[13.5px] font-medium text-ink">{item.label}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <dl className="grid gap-x-10 gap-y-3 sm:grid-cols-2">
            {AMENITY_CATEGORIES.filter((c) => c !== 'standout').map((category) => {
              const items = picked.filter((a) => a.category === category);
              if (!items.length) return null;
              return (
                <div key={category}>
                  <dt className="text-[13px] text-slate">{AMENITY_CATEGORY_LABELS[category]}</dt>
                  <dd className="mt-0.5 text-[14px] leading-relaxed text-ink">
                    {items.map((a) => a.label).join(', ')}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      ) : (
        <p className="text-[14.5px]">
          <Missing>None picked yet.</Missing>
        </p>
      )}
    </Section>
  );
}
