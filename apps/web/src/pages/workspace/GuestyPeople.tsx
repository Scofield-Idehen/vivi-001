import { type GuestyPerson, ROLE_LABELS, SKILL_LABELS } from '@v01/shared';
import { useState } from 'react';
import { useConfirm } from '../../components/Confirm.tsx';
import { homesText } from '../../components/HomesPicker.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import { ApiError, useAddGuestyPeople, useGuestyPeople } from '../../lib/api.ts';

/**
 * The people on the Guesty account (1 Nov 2026), grouped by what they do, to bring onto the team.
 * Adding someone makes their sign-in without emailing them: they join the field team with their
 * skills and homes from Guesty, can be given jobs straight away, and sign in later with their email.
 */

const explain = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That didn’t go through. Try again.';

function groupOf(p: GuestyPerson): 'cleaning' | 'maintenance' | 'other' {
  if (p.skills.includes('cleaning')) return 'cleaning';
  if (p.skills.includes('maintenance')) return 'maintenance';
  return 'other';
}

const GROUPS = [
  ['cleaning', 'Cleaners'],
  ['maintenance', 'Maintenance'],
  ['other', 'Everyone else on Guesty'],
] as const;

export function GuestyPeople({ orgId, homes }: { orgId: string; homes: { id: string; name: string }[] }) {
  const list = useGuestyPeople(orgId);
  const add = useAddGuestyPeople(orgId);
  const confirm = useConfirm();
  const people = list.data?.people ?? [];
  const waiting = people.filter((p) => !p.memberId);
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (people.length === 0) return null;
  // Cleaners and maintenance are ticked to start with; the office is left to choose.
  const picked = chosen ?? new Set(waiting.filter((p) => p.skills.length && p.email).map((p) => p.id));
  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  };

  return (
    <div className="mt-6 rounded-2xl border border-hairline bg-canvas p-4">
      <h3 className="font-semibold tracking-[-0.015em] text-[18px] text-ink">From Guesty</h3>
      <p className="mt-1 max-w-[62ch] text-[13.5px] text-slate">
        {waiting.length
          ? `${waiting.length} of ${people.length} people on your Guesty account aren’t on the team here yet. Adding them doesn’t email them: they join the field team with their skills and homes from Guesty, can be given jobs straight away, and sign in later with their email.`
          : `Everyone from your Guesty account is on the team here.`}
      </p>
      {GROUPS.map(([key, title]) => {
        const group = people.filter((p) => groupOf(p) === key);
        if (!group.length) return null;
        return (
          <div key={key} className="mt-4">
            <p className="mb-1 text-[13px] text-slate">
              {title} <span className="text-mist">({group.length})</span>
            </p>
            <ul className="divide-y divide-hairline border-y border-hairline bg-white">
              {group.map((p) => {
                const here = Boolean(p.memberId);
                const disabled = here || !p.email;
                return (
                  <li key={p.id}>
                    <label
                      className={`flex items-start gap-3 px-3 py-2.5 text-[14px] ${disabled ? '' : 'cursor-pointer hover:bg-linen/50'}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-[var(--color-accent)]"
                        checked={!disabled && picked.has(p.id)}
                        disabled={disabled}
                        onChange={() => toggle(p.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ink">{p.name}</span>
                        <span className="block truncate text-[12.5px] text-slate">
                          {p.email ?? 'No email in Guesty, so they can’t be added'}
                          {p.skills.length ? ` · ${p.skills.map((s) => SKILL_LABELS[s]).join(', ')}` : ''}
                          {` · ${homesText(p.propertyIds, homes)}`}
                        </span>
                      </span>
                      {here ? (
                        <span className="shrink-0 text-[12.5px] text-done">
                          On the team{p.memberRole ? `, ${ROLE_LABELS[p.memberRole]}` : ''}
                        </span>
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {add.error ? (
        <div className="mt-3">
          <Notice tone="urgent">{explain(add.error)}</Notice>
        </div>
      ) : null}
      {done ? (
        <div className="mt-3">
          <Notice tone="done">{done}</Notice>
        </div>
      ) : null}
      {waiting.length ? (
        <div className="mt-4">
          <Button
            variant="primary"
            disabled={picked.size === 0 || add.isPending}
            onClick={async () => {
              const ids = [...picked];
              if (
                !(await confirm({
                  title: `Add ${ids.length} ${ids.length === 1 ? 'person' : 'people'} to the team?`,
                  body: 'They join the field team with their skills and homes from Guesty. Nobody gets an email now; they can be given jobs straight away and sign in later with their email.',
                  action: 'Add to the team',
                }))
              )
                return;
              add.mutate(
                { ids },
                {
                  onSuccess: (r) => {
                    setChosen(null);
                    setDone(
                      `${r.added} added${r.updated ? `, ${r.updated} already here and updated` : ''}.${
                        r.skipped.length
                          ? ` Left out: ${r.skipped.map((s) => `${s.name} (${s.reason})`).join('; ')}`
                          : ''
                      }`,
                    );
                  },
                },
              );
            }}
          >
            {picked.size ? `Add ${picked.size} to the team` : 'Choose who to add'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
