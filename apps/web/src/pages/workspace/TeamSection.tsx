import { can, MEMBER_ROLES, type MemberRole, ROLE_LABELS, type WorkspaceRole } from '@v01/shared';
import { useState } from 'react';
import { SelectField, TextField } from '../../components/fields.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import {
  ApiError,
  useCancelInvitation,
  useChangeRole,
  useInvitations,
  useInvite,
  useRemoveMember,
  useTeam,
} from '../../lib/api.ts';
import { shortDate } from '../../lib/format.ts';

/**
 * Who is in the workspace, and inviting a colleague by email and role. The invitation email comes
 * from the sign-in system; the first time that email signs in, the person is in, with that role.
 */

const explain = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That didn’t go through. Try again.';

const ROLE_HELP: Record<MemberRole, string> = {
  admin: 'Everything, including the team and settings.',
  operations: 'Properties, calendar, bookings, tasks and the Inbox.',
  guest_comms: 'Bookings and the Inbox; no property settings.',
  accounts: 'Reads bookings and money; no guest contact, no codes.',
  field: 'Their own jobs on a phone; no guest names.',
};

const ROLE_OPTIONS = MEMBER_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

export function TeamSection({ orgId, role, selfId }: { orgId: string; role: WorkspaceRole; selfId: string }) {
  const manage = can(role, 'members.manage');
  const team = useTeam(orgId);
  const invitations = useInvitations(orgId, manage);
  const invite = useInvite(orgId);
  const cancel = useCancelInvitation(orgId);
  const change = useChangeRole(orgId);
  const remove = useRemoveMember(orgId);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [newRole, setNewRole] = useState<MemberRole>('operations');
  const [done, setDone] = useState<string | null>(null);
  const members = team.data?.members ?? [];
  const open = invitations.data?.invitations ?? [];
  const ready =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && name.trim().length > 0 && !invite.isPending;

  const send = () => {
    if (!ready) return;
    invite.mutate(
      { email: email.trim(), name: name.trim(), role: newRole },
      {
        onSuccess: (r) => {
          setEmail('');
          setName('');
          setDone(
            r.email === 'invited'
              ? `${r.invitation.email} has an email with a sign-in link.`
              : r.email === 'existing'
                ? `${r.invitation.email} already had a sign-in; they’ve been sent a link, and they’re in the moment they use it.`
                : `${r.invitation.email} is invited, but no email went out${r.reason ? `: ${r.reason}` : ''}. They can still sign in at this address with that email.`,
          );
        },
      },
    );
  };

  return (
    <section aria-labelledby="team" className="lg:col-span-2">
      <h2 id="team" className="mb-1 text-[15px] font-medium">
        Team
      </h2>
      <p className="mb-3 text-[13px] text-slate">
        {manage
          ? 'Who can sign in, and as what. Invite a colleague by email; they sign in with it and they’re in.'
          : 'Who can sign in, and as what.'}
      </p>
      {team.error ? <Notice tone="urgent">{explain(team.error)}</Notice> : null}
      <ul className="divide-y divide-hairline border-y border-hairline">
        {members.map((m) => (
          <li
            key={m.id}
            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-[14px]"
          >
            <div className="min-w-0">
              {renaming?.id === m.id ? (
                <span className="flex flex-wrap items-center gap-2">
                  <input
                    value={renaming.name}
                    onChange={(e) => setRenaming({ id: m.id, name: e.target.value })}
                    aria-label="Name"
                    className="h-8 w-[220px] rounded-md border border-edge bg-white px-2.5 text-[14px] text-ink focus:border-accent focus:outline-none"
                  />
                  <Button
                    variant="primary"
                    className="!h-8"
                    disabled={!renaming.name.trim() || change.isPending}
                    onClick={() =>
                      change.mutate(
                        { userId: m.id, name: renaming.name.trim() },
                        { onSuccess: () => setRenaming(null) },
                      )
                    }
                  >
                    Save
                  </Button>
                  <Button variant="quiet" onClick={() => setRenaming(null)}>
                    Cancel
                  </Button>
                </span>
              ) : (
                <p className="flex items-center gap-1 text-ink">
                  <span className="truncate">{m.name}</span>
                  {m.id === selfId ? <span className="text-mist"> (you)</span> : null}
                  {manage && m.id !== selfId ? (
                    <button
                      type="button"
                      onClick={() => setRenaming({ id: m.id, name: m.name === m.email ? '' : m.name })}
                      className="action !h-7 text-[12.5px]"
                    >
                      {m.name === m.email ? 'Add name' : 'Rename'}
                    </button>
                  ) : null}
                </p>
              )}
              {m.email && m.email !== m.name ? (
                <p className="truncate text-[12.5px] text-slate">{m.email}</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {manage && m.id !== selfId ? (
                <select
                  aria-label={`${m.name}’s role`}
                  value={m.role}
                  disabled={change.isPending}
                  onChange={(e) => change.mutate({ userId: m.id, role: e.target.value as MemberRole })}
                  className="h-8 rounded-lg border border-hairline bg-canvas px-2 text-[13px] text-ink"
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-slate">{ROLE_LABELS[m.role]}</span>
              )}
              {manage && m.id !== selfId ? (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(`Remove ${m.name} from this workspace? They can be invited again later.`)
                    )
                      remove.mutate(m.id);
                  }}
                  disabled={remove.isPending}
                  className="action action-urgent -mr-2.5"
                >
                  Remove
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {change.error || remove.error ? (
        <div className="mt-3">
          <Notice tone="urgent">{explain(change.error ?? remove.error)}</Notice>
        </div>
      ) : null}

      {manage ? (
        <>
          {open.length ? (
            <>
              <h3 className="mt-6 mb-1 text-[13px] text-slate">Invited, not signed in yet</h3>
              <ul className="divide-y divide-hairline border-y border-hairline">
                {open.map((i) => (
                  <li
                    key={i.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-[14px]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-ink">
                        {i.name ?? i.email}
                        {i.name ? <span className="text-slate"> · {i.email}</span> : null}
                      </p>
                      <p className="text-[12.5px] text-slate">
                        {ROLE_LABELS[i.role]} · invited {shortDate(i.createdAt)}
                        {i.invitedBy ? ` by ${i.invitedBy}` : ''}
                        {i.expiresAt ? ` · open until ${shortDate(i.expiresAt)}` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => cancel.mutate(i.id)}
                      disabled={cancel.isPending}
                      className="action -mr-2.5"
                    >
                      Cancel invitation
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <div className="mt-6 flex max-w-[560px] flex-col gap-4 rounded-2xl border border-hairline bg-canvas p-4">
            <h3 className="font-serif text-[20px] text-ink">Invite a colleague</h3>
            <TextField
              label="Name"
              value={name}
              onChange={setName}
              placeholder="Alessio Failla"
              autoComplete="off"
              hint="Shown everywhere instead of their email."
            />
            <TextField
              label="Email"
              value={email}
              onChange={setEmail}
              placeholder="name@vivistays.com"
              autoComplete="email"
            />
            <SelectField
              label="Role"
              value={newRole}
              onChange={(v) => setNewRole(v as MemberRole)}
              options={ROLE_OPTIONS}
              hint={ROLE_HELP[newRole]}
            />
            {invite.error ? <Notice tone="urgent">{explain(invite.error)}</Notice> : null}
            {done ? <Notice tone="done">{done}</Notice> : null}
            <div>
              <Button variant="primary" onClick={send} disabled={!ready}>
                Send invitation
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
