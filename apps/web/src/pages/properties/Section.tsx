import { IconCheck } from '@tabler/icons-react';
import type { ListingSection } from '@v01/shared';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { Button } from '../../components/ui.tsx';
import { ApiError } from '../../lib/api.ts';

export const SECTION_TITLES: Record<ListingSection, string> = {
  photos: 'Photos',
  place: 'The place',
  rooms: 'Rooms and beds',
  amenities: 'Amenities',
  description: 'Title and description',
  address: 'Address',
  arrival: 'Arriving',
  rules: 'House rules',
  booking: 'Booking rules',
  pricing: 'Prices and fees',
  licence: 'Licence',
  channels: 'Channels',
};

export const sectionAnchor = (id: ListingSection) => `section-${id}`;

/** Opens a section for editing with a copy of what's saved, and saves it back in one go. */
export function useEditor<T>(load: () => T, save: (draft: T) => Promise<unknown>) {
  const [draft, setDraft] = useState<T | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(false), 2500);
    return () => window.clearTimeout(timer);
  }, [saved]);

  return {
    editing: draft !== null,
    draft,
    saving,
    error,
    saved,
    set(patch: Partial<T>) {
      setDraft((current) => (current === null ? current : { ...current, ...patch }));
    },
    start() {
      setDraft(load());
      setError(null);
      setSaved(false);
    },
    cancel() {
      setDraft(null);
      setError(null);
    },
    async submit(event?: FormEvent) {
      event?.preventDefault();
      if (draft === null) return;
      setSaving(true);
      setError(null);
      try {
        await save(draft);
        setDraft(null);
        setSaved(true);
      } catch (cause) {
        setError(
          cause instanceof ApiError || cause instanceof InvalidDraft
            ? cause.message
            : 'That could not be saved. Try again.',
        );
      } finally {
        setSaving(false);
      }
    },
  };
}

/** Thrown from a section's save when what was typed can't be sent; the message is shown as is. */
export class InvalidDraft extends Error {}

export type Editor<T> = ReturnType<typeof useEditor<T>>;

/** One part of the listing: what's there now, and an Edit button that turns it into a form. */
export function Section({
  id,
  description,
  editor,
  canEdit,
  action,
  children,
}: {
  id: ListingSection;
  description?: ReactNode;
  editor?: Editor<unknown> | { editing: boolean; saved: boolean; start(): void };
  canEdit: boolean;
  /** Replaces the Edit button, for sections that save as you go (photos). */
  action?: ReactNode;
  children: ReactNode;
}) {
  const titleId = `${sectionAnchor(id)}-title`;
  return (
    <section
      id={sectionAnchor(id)}
      aria-labelledby={titleId}
      className="scroll-mt-6 border-t border-hairline py-10 first:border-t-0 first:pt-2"
    >
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h2
            id={titleId}
            tabIndex={-1}
            className="font-serif text-[24px] leading-tight text-ink outline-none"
          >
            {SECTION_TITLES[id]}
          </h2>
          {description ? (
            <p className="mt-1.5 max-w-[62ch] text-[14px] leading-relaxed text-slate">{description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {editor?.saved ? (
            <span className="inline-flex items-center gap-1 text-[13px] text-done-text" role="status">
              <IconCheck size={15} stroke={2} aria-hidden />
              Saved
            </span>
          ) : null}
          {action ??
            (canEdit && editor && !editor.editing ? (
              <Button onClick={() => editor.start()}>
                Edit<span className="sr-only"> {SECTION_TITLES[id].toLowerCase()}</span>
              </Button>
            ) : null)}
        </div>
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

/** The form a section turns into, with Save and Cancel at the bottom. */
export function SectionForm<T>({ editor, children }: { editor: Editor<T>; children: ReactNode }) {
  return (
    <form onSubmit={(e) => void editor.submit(e)} noValidate>
      <div className="flex flex-col gap-5">{children}</div>
      <div className="mt-7 flex flex-wrap items-center gap-4">
        <Button variant="primary" type="submit" disabled={editor.saving}>
          {editor.saving ? 'Saving' : 'Save'}
        </Button>
        <Button variant="quiet" onClick={() => editor.cancel()} disabled={editor.saving}>
          Cancel
        </Button>
        {editor.error ? (
          <p role="alert" className="text-[13px] text-urgent">
            {editor.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}

/** A read-only list of label and value pairs. */
export function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="divide-y divide-hairline border-y border-hairline">
      {items.map((item) => (
        <div key={item.label} className="grid gap-x-6 gap-y-0.5 py-3 sm:grid-cols-[200px_minmax(0,1fr)]">
          <dt className="text-[13.5px] text-slate">{item.label}</dt>
          <dd className="text-[14.5px] leading-relaxed text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Missing({ children }: { children: ReactNode }) {
  return <span className="text-mist">{children}</span>;
}
