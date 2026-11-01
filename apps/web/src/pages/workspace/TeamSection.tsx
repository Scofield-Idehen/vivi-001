import {
  can,
  ROLE_LABELS,
  SKILL_LABELS,
  SKILLS,
  type Skill,
  STAFF_ROLES,
  type StaffRole,
  type WorkspaceRole,
} from '@v01/shared';
import { useState } from 'react';
import { useConfirm } from '../../components/Confirm.tsx';
import { SelectField, TextField } from '../../components/fields.tsx';
import { HomesPicker, homesText } from '../../components/HomesPicker.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import {
  ApiError,
  useCancelInvitation,
  useChangeRole,
  useInvitations,
  useInvite,
  useMemberHomes,
  useMemberSkills,
  useProperties,
  useRemoveMember,
  useTeam,
} from '../../lib/api.ts';
import { shortDate } from '../../lib/format.ts';
import { GuestyPeople } from './GuestyPeople.tsx';

/**
 * Who is in the workspace, and inviting a colleague by email and role. The invitation email comes
 * from the sign-in system; the first time that email signs in, the person is in, with that role.
 */

const explain = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That didn’t go through. Try again.';

const ROLE_HELP: Record<StaffRole, string> = {
  admin: 'Everything, including the team and settings.',
  operations: 'Properties, calendar, bookings, tasks and the Inbox.',
  guest_comms: 'Bookings and the Inbox; no property settings.',
  accounts: 'Reads bookings and money; no guest contact, no codes.',
  field: 'Their own jobs on a phone; no guest names.',
};

/** Two small switches: which jobs a person does. */
function SkillSwitches({
  skills,
  onChange,
  disabled = false,
  label,
}: {
  skills: Skill[];
  onChange(next: Skill[]): void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <fieldset aria-label={label} className="m-0 inline-flex min-w-0 gap-1 border-0 p-0">
      {SKILLS.map((s) => {
        const on = skills.includes(s);
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on ? skills.filter((x) => x !== s) : [...skills, s])}
            className={`h-6 rounded-full border px-2.5 text-[12px] ${on ? 'border-accent bg-accent text-white' : 'border-hairline bg-white text-slate hover:border-edge'}`}
          >
            {SKILL_LABELS[s]}
          </button>
        );
      })}
    </fieldset>
  );
}

const ROLE_OPTIONS = STAFF_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

export function TeamSection({ orgId, role, selfId }: { orgId: string; role: WorkspaceRole; selfId: string }) {
  const manage = can(role, 'members.manage');
  const team = useTeam(orgId);
  const invitations = useInvitations(orgId, manage);
  const invite = useInvite(orgId);
  const cancel = useCancelInvitation(orgId);
  const change = useChangeRole(orgId);
  const remove = useRemoveMember(orgId);
  const confirm = useConfirm();
  const homesOf = useMemberHomes(orgId);
  const skillsOf = useMemberSkills(orgId);
  const [newSkills, setNewSkills] = useState<Skill[]>([]);
  const properties = useProperties(manage ? orgId : null);
  const homes = (properties.data?.properties ?? [])
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((x, y) => x.name.localeCompare(y.name));
  const [picking, setPicking] = useState<{ userId: string; name: string; ids: string[] | null } | null>(null);
  const [newHomes, setNewHomes] = useState<string[] | null>(null);
  const [pickingNew, setPickingNew] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [newRole, setNewRole] = useState<StaffRole>('operations');
  const [done, setDone] = useState<string | null>(null);
  const members = team.data?.members ?? [];
  const open = invitations.data?.invitations ?? [];
  const ready =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && name.trim().length > 0 && !invite.isPending;

  const send = () => {
    if (!ready) return;
    invite.mutate(
      {
        email: email.trim(),
        name: name.trim(),
        role: newRole,
        propertyIds: newRole === 'admin' ? null : newHomes,
        skills: newSkills,
      },
      {
        onSuccess: (r) => {
          setEmail('');
          setName('');
          setNewHomes(null);
          setNewSkills([]);
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
              {manage ? (
                <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-slate">
                  <span className={m.propertyIds ? 'text-ink' : ''}>
                    {m.role === 'admin' ? 'Every home (admin)' : homesText(m.propertyIds, homes)}
                  </span>
                  {m.role !== 'admin' && m.role !== 'owner' ? (
                    <button
                      type="button"
                      className="action !h-6 text-[12px]"
                      onClick={() => setPicking({ userId: m.id, name: m.name, ids: m.propertyIds })}
                    >
                      Change homes
                    </button>
                  ) : null}
                </p>
              ) : null}
              {manage && m.role !== 'owner' ? (
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-slate">
                  <span>Jobs</span>
                  <SkillSwitches
                    label={`Jobs ${m.name} does`}
                    skills={m.skills}
                    disabled={skillsOf.isPending}
                    onChange={(skills) => skillsOf.mutate({ userId: m.id, skills })}
                  />
                </div>
              ) : m.skills.length ? (
                <p className="mt-0.5 text-[12.5px] text-slate">
                  {m.skills.map((s) => SKILL_LABELS[s]).join(', ')}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {manage && m.id !== selfId ? (
                <select
                  aria-label={`${m.name}’s role`}
                  value={m.role}
                  disabled={change.isPending}
                  onChange={(e) => change.mutate({ userId: m.id, role: e.target.value as StaffRole })}
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
                  onClick={async () => {
                    if (
                      await confirm({
                        title: `Remove ${m.name}?`,
                        body: 'They can no longer sign in to this workspace. You can invite them again later.',
                        action: 'Remove',
                        tone: 'urgent',
                      })
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
      {picking ? (
        <HomesPicker
          person={picking.name}
          homes={homes}
          selected={picking.ids}
          busy={homesOf.isPending}
          error={homesOf.error ? explain(homesOf.error) : null}
          onClose={() => {
            homesOf.reset();
            setPicking(null);
          }}
          onSave={(ids) =>
            homesOf.mutate(
              { userId: picking.userId, propertyIds: ids },
              { onSuccess: () => setPicking(null) },
            )
          }
        />
      ) : null}
      {pickingNew ? (
        <HomesPicker
          person={name.trim() || 'they'}
          homes={homes}
          selected={newHomes}
          onClose={() => setPickingNew(false)}
          onSave={(ids) => {
            setNewHomes(ids);
            setPickingNew(false);
          }}
        />
      ) : null}
      {change.error || remove.error || skillsOf.error ? (
        <div className="mt-3">
          <Notice tone="urgent">{explain(change.error ?? remove.error ?? skillsOf.error)}</Notice>
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
                        {ROLE_LABELS[i.role]}
                        {i.skills.length
                          ? `, ${i.skills.map((s) => SKILL_LABELS[s].toLowerCase()).join(' and ')}`
                          : ''}
                        {i.propertyIds
                          ? `, ${homesText(i.propertyIds, homes).replace(/^Only /, 'only ')}`
                          : ''}{' '}
                        · invited {shortDate(i.createdAt)}
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

          <GuestyPeople orgId={orgId} homes={homes} />

          <div className="mt-6 flex max-w-[560px] flex-col gap-4 rounded-2xl border border-hairline bg-canvas p-4">
            <h3 className="font-semibold tracking-[-0.015em] text-[18px] text-ink">Invite a colleague</h3>
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
              onChange={(v) => setNewRole(v as StaffRole)}
              options={ROLE_OPTIONS}
              hint={ROLE_HELP[newRole]}
            />
            {newRole === 'admin' ? null : (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hairline bg-white px-3.5 py-2.5 text-[14px]">
                <span>
                  <span className="block text-[12.5px] text-slate">Homes they can see</span>
                  <span className="text-ink">{homesText(newHomes, homes)}</span>
                </span>
                <button type="button" className="action" onClick={() => setPickingNew(true)}>
                  Choose homes
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-hairline bg-white px-3.5 py-2.5 text-[14px]">
              <span className="block text-[12.5px] text-slate">
                Jobs they do
                <span className="block text-[12px] text-mist">
                  A clean goes only to cleaning; a repair to maintenance.
                </span>
              </span>
              <SkillSwitches label="Jobs they do" skills={newSkills} onChange={setNewSkills} />
            </div>
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
