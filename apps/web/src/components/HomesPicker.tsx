import { useMemo, useState } from 'react';
import { Sheet } from './Sheet.tsx';
import { Button, Notice } from './ui.tsx';

/**
 * Access by home: every home, or only the ones ticked. Used for a colleague on the team and for
 * an invitation. What's chosen here is enforced by the database on every page they open.
 */
export function HomesPicker({
  person,
  homes,
  selected,
  busy = false,
  error,
  onSave,
  onClose,
}: {
  person: string;
  homes: { id: string; name: string }[];
  /** Null for every home. */
  selected: string[] | null;
  busy?: boolean;
  error?: string | null;
  onSave(ids: string[] | null): void;
  onClose(): void;
}) {
  const [every, setEvery] = useState(selected === null);
  const [ticked, setTicked] = useState<Set<string>>(new Set(selected ?? []));
  const [q, setQ] = useState('');
  const shown = useMemo(
    () => homes.filter((h) => h.name.toLowerCase().includes(q.trim().toLowerCase())),
    [homes, q],
  );
  const toggle = (id: string) =>
    setTicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const choice = (on: boolean, label: string, hint: string) => (
    <button
      type="button"
      aria-pressed={every === on}
      onClick={() => setEvery(on)}
      className={`flex-1 rounded-xl border px-3.5 py-2.5 text-left text-[14px] ${
        every === on ? 'border-accent bg-white text-ink' : 'border-hairline text-slate hover:border-edge'
      }`}
    >
      <span className="block font-medium">{label}</span>
      <span className="block text-[12.5px] text-slate">{hint}</span>
    </button>
  );
  return (
    <Sheet
      title={`Homes ${person} can see`}
      subtitle="Everything else stays out of sight: bookings, guests, tasks, messages and money."
      onClose={onClose}
      busy={busy}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] text-slate">
            {every ? 'Every home' : `${ticked.size} of ${homes.length} homes`}
          </span>
          <div className="flex gap-2">
            <Button variant="quiet" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || (!every && ticked.size === 0)}
              onClick={() => onSave(every ? null : homes.filter((h) => ticked.has(h.id)).map((h) => h.id))}
            >
              Save
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        <div className="flex gap-2">
          {choice(true, 'Every home', 'Including homes added later.')}
          {choice(false, 'Only some homes', 'Tick the ones they look after.')}
        </div>
        {every ? null : (
          <>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a home"
              aria-label="Find a home"
              className="h-9 rounded-lg border border-edge bg-white px-3 text-[14px] focus:border-accent focus:outline-none"
            />
            <div className="flex gap-2 text-[13px]">
              <button
                type="button"
                className="action !h-7"
                onClick={() => setTicked(new Set([...ticked, ...shown.map((h) => h.id)]))}
              >
                Tick {q.trim() ? 'these' : 'all'}
              </button>
              <button type="button" className="action !h-7" onClick={() => setTicked(new Set())}>
                Clear
              </button>
            </div>
            <ul className="divide-y divide-hairline border-y border-hairline">
              {shown.map((h) => (
                <li key={h.id}>
                  <label className="flex cursor-pointer items-center gap-3 py-2.5 text-[14px] hover:bg-paper">
                    <input
                      type="checkbox"
                      checked={ticked.has(h.id)}
                      onChange={() => toggle(h.id)}
                      className="size-4 accent-[var(--color-accent)]"
                    />
                    {h.name}
                  </label>
                </li>
              ))}
              {shown.length === 0 ? (
                <li className="py-3 text-[13px] text-slate">No home by that name.</li>
              ) : null}
            </ul>
          </>
        )}
        {error ? <Notice tone="urgent">{error}</Notice> : null}
      </div>
    </Sheet>
  );
}

/** "Every home", "Lodge", "Lodge and Flat", "4 homes". */
export function homesText(ids: string[] | null, homes: { id: string; name: string }[]): string {
  if (ids === null) return 'Every home';
  if (ids.length === 0) return 'No homes';
  const names = homes.filter((h) => ids.includes(h.id)).map((h) => h.name);
  if (names.length === 1) return `Only ${names[0]}`;
  if (names.length === 2) return `Only ${names[0]} and ${names[1]}`;
  return `${ids.length} homes`;
}
