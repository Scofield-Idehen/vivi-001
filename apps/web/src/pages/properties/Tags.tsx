import { IconPlus, IconX } from '@tabler/icons-react';
import { TAG_MAX } from '@v01/shared';
import { type FormEvent, type KeyboardEvent, useId, useMemo, useState } from 'react';
import { Button } from '../../components/ui.tsx';
import { ApiError, useProperties } from '../../lib/api.ts';
import { addTag } from './tagList.ts';

const chip =
  'inline-flex h-7 items-center gap-1 rounded-full border border-hairline bg-canvas text-[12.5px] text-slate';

/**
 * The team's own labels for a property, such as its owner or "Sea view". The Calendar filters by
 * them; guests and channels never see them.
 */
export function Tags({
  orgId,
  tags,
  canEdit,
  save,
}: {
  orgId: string;
  tags: string[];
  canEdit: boolean;
  save(tags: string[]): Promise<unknown>;
}) {
  const [draft, setDraft] = useState<string[] | null>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputId = useId();
  const listId = useId();
  const hintId = useId();

  // Tags used on other properties, offered as they type.
  const properties = useProperties(draft ? orgId : null);
  const known = useMemo(() => {
    const all = new Map<string, string>();
    for (const p of properties.data?.properties ?? []) {
      for (const tag of p.tags) all.set(tag.toLowerCase(), tag);
    }
    return [...all.values()].sort((a, b) => a.localeCompare(b));
  }, [properties.data]);

  if (!draft) {
    if (tags.length === 0 && !canEdit) return null;
    return (
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="sr-only">Tags:</span>
        {tags.map((tag) => (
          <span key={tag} className={`${chip} px-2.5`}>
            {tag}
          </span>
        ))}
        {canEdit ? (
          <button
            type="button"
            onClick={() => {
              setDraft(tags);
              setTyped('');
              setError(null);
            }}
            className={
              tags.length
                ? 'ml-1 text-[13px] text-accent underline-offset-4 hover:underline'
                : 'inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-edge px-2.5 text-[12.5px] text-slate hover:border-ink hover:text-ink'
            }
          >
            {tags.length ? (
              'Edit tags'
            ) : (
              <>
                <IconPlus size={13} stroke={2} aria-hidden />
                Add tags
              </>
            )}
          </button>
        ) : null}
      </div>
    );
  }

  const add = () => {
    const result = addTag(draft, typed);
    setDraft(result.tags);
    setError(result.error);
    if (!result.error) setTyped('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && typed === '' && draft.length) {
      setDraft(draft.slice(0, -1));
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(null);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // A tag still being typed counts.
    const result = addTag(draft, typed);
    if (result.error) {
      setError(result.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await save(result.tags);
      setDraft(null);
      setTyped('');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The tags could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="mt-3 max-w-[640px]">
      <label htmlFor={inputId} className="text-[13px] text-slate">
        Tags
      </label>
      <div className="mt-1.5 flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-edge bg-white px-2 py-1.5 focus-within:border-accent">
        {draft.map((tag) => (
          <span key={tag} className={`${chip} pr-1 pl-2.5`}>
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => setDraft(draft.filter((t) => t !== tag))}
              className="grid size-5 place-items-center rounded-full text-mist hover:bg-linen hover:text-ink"
            >
              <IconX size={12} stroke={2.2} aria-hidden />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          // biome-ignore lint/a11y/noAutofocus: opened on purpose, to type straight away
          autoFocus
          value={typed}
          list={listId}
          maxLength={TAG_MAX + 10}
          onChange={(event) => {
            setTyped(event.target.value);
            setError(null);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => typed.trim() && add()}
          aria-describedby={hintId}
          placeholder={draft.length ? 'Add another' : 'Owner, area, “Sea view”…'}
          className="h-7 min-w-[140px] flex-1 bg-transparent px-1 text-[14px] text-ink placeholder:text-mist focus:outline-none [&::-webkit-calendar-picker-indicator]:hidden"
        />
        <datalist id={listId}>
          {known
            .filter((tag) => !draft.some((t) => t.toLowerCase() === tag.toLowerCase()))
            .map((tag) => (
              <option key={tag} value={tag} />
            ))}
        </datalist>
      </div>
      <p id={hintId} className="mt-1.5 text-[12.5px] text-mist">
        Press Enter after each one. Only your team sees tags; the Calendar can filter by them.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <Button variant="primary" type="submit" disabled={saving}>
          {saving ? 'Saving' : 'Save tags'}
        </Button>
        <Button variant="quiet" onClick={() => setDraft(null)} disabled={saving}>
          Cancel
        </Button>
        {error ? (
          <p role="alert" className="text-[13px] text-urgent">
            {error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
