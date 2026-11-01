import { IconLogin2 } from '@tabler/icons-react';
import { useState } from 'react';
import { Button, Notice } from '../../components/ui.tsx';
import {
  ApiError,
  useCancelOwnerInvitation,
  useGiveOwnerLogin,
  useOwners,
  useRemoveOwnerLogin,
} from '../../lib/api.ts';
import { shortDate } from '../../lib/format.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';

/**
 * The owner's log-in, on their page: who can sign in as this owner, and giving or taking a
 * log-in. Signed in, an owner sees their own homes' bookings (no guest names) and their finalised
 * statements, and nothing else.
 */

const explain = (e: unknown) => (e instanceof ApiError ? e.message : 'That didn’t go through. Try again.');

export function OwnerLogin({ ownerId, write }: { ownerId: string; write: boolean }) {
  const { orgId } = useCurrentWorkspace();
  const owners = useOwners(orgId);
  const o = owners.data?.owners.find((x) => x.id === ownerId);
  const give = useGiveOwnerLogin(orgId, ownerId);
  const remove = useRemoveOwnerLogin(orgId, ownerId);
  const cancel = useCancelOwnerInvitation(orgId, ownerId);
  const [email, setEmail] = useState<string | null>(null);
  if (!o) return null;
  const typed = email ?? o.email ?? '';
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typed.trim());
  const error = give.error ?? remove.error ?? cancel.error;
  const none = o.logins.length === 0 && o.invited.length === 0;

  return (
    <section
      aria-labelledby="owner-login"
      className="mb-8 rounded-2xl border border-hairline bg-paper px-5 py-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="owner-login" className="flex items-center gap-2 text-[15px] font-medium text-ink">
            <IconLogin2 size={17} stroke={1.75} aria-hidden /> Owner log-in
          </h2>
          <p className="mt-0.5 max-w-[62ch] text-[13px] text-slate">
            {none
              ? `${o.name} can’t sign in yet. Invite them and they sign in with the link in their email, no password: they see their homes’ bookings and their statements, and nothing else.`
              : 'They sign in with a link sent to their email and see their homes’ bookings and finalised statements only.'}
          </p>
        </div>
      </div>

      {o.logins.length || o.invited.length ? (
        <ul className="mt-3 divide-y divide-hairline border-y border-hairline text-[14px]">
          {o.logins.map((l) => (
            <li key={l.userId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="min-w-0">
                <span className="mr-2 rounded-full bg-done/15 px-2 py-0.5 text-[12px] text-done-text">
                  Can log in
                </span>
                {l.email}
              </span>
              {write ? (
                <button
                  type="button"
                  className="action action-urgent -mr-2.5"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Stop ${l.email} signing in as ${o.name}?`)) remove.mutate(l.userId);
                  }}
                >
                  Remove log-in
                </button>
              ) : null}
            </li>
          ))}
          {o.invited.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="min-w-0">
                <span className="mr-2 rounded-full bg-pending/15 px-2 py-0.5 text-[12px] text-pending-text">
                  Invited
                </span>
                {i.email}
                {i.expiresAt ? (
                  <span className="text-slate"> · open until {shortDate(i.expiresAt)}</span>
                ) : null}
              </span>
              {write ? (
                <button
                  type="button"
                  className="action -mr-2.5"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(i.id)}
                >
                  Cancel invitation
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {write ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-[12.5px] text-slate">
            {none ? 'Their email' : 'Another email (a partner or accountant)'}
            <input
              value={none ? typed : (email ?? '')}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="off"
              placeholder="owner@example.com"
              className="h-9 rounded-lg border border-edge bg-white px-3 text-[14px] text-ink focus:border-accent focus:outline-none"
            />
          </label>
          <Button
            variant={none ? 'primary' : 'secondary'}
            disabled={!ok || give.isPending || (!none && !email)}
            onClick={() =>
              give.mutate(
                { email: (none ? typed : (email ?? '')).trim() },
                { onSuccess: () => setEmail(null) },
              )
            }
          >
            {none ? 'Invite to log in' : 'Invite'}
          </Button>
        </div>
      ) : null}
      {error ? (
        <div className="mt-3">
          <Notice tone="urgent">{explain(error)}</Notice>
        </div>
      ) : null}
    </section>
  );
}
