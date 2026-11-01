import { IconSearch } from '@tabler/icons-react';
import { type Owner, type OwnerList, type OwnerLoginBulkResult, todayIn } from '@v01/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { monthName } from '../../components/MonthPicker.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import { ApiError, useGiveHome, useInviteOwners, useStatements, useWorkspace } from '../../lib/api.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { moneyText } from '../properties/money.ts';

/**
 * The owners at a glance (1 Nov 2026): how many homes each has (one owner can have many), whether
 * they can log in, and the homes nobody owns yet, each given to an owner in one choice.
 */

const explain = (e: unknown) => (e instanceof ApiError ? e.message : 'That didn’t go through. Try again.');

type Access = 'in' | 'invited' | 'none';
const accessOf = (o: Owner): Access => (o.logins.length ? 'in' : o.invited.length ? 'invited' : 'none');
const ACCESS: Record<Access, { label: string; tone: string }> = {
  in: { label: 'Can log in', tone: 'bg-done/15 text-done-text' },
  invited: { label: 'Invited', tone: 'bg-pending/15 text-pending-text' },
  none: { label: 'No log-in', tone: 'bg-linen text-slate' },
};
type Filter = Access | 'all' | 'setup';
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['setup', 'Still to set up'],
  ['in', 'Can log in'],
  ['invited', 'Invited'],
  ['none', 'No log-in'],
];
const needsSetup = (o: Owner) => !o.setup.contract || o.setup.homesWithoutTerms > 0;

function homesLine(o: Owner): string {
  if (!o.homes.length) return 'No homes yet';
  const names = o.homes.map((h) => h.name);
  return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2} more`;
}

export function OwnersList({ data, write }: { data: OwnerList; write: boolean }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const { orgId } = useCurrentWorkspace();
  const workspace = useWorkspace(orgId);
  const thisMonth = todayIn(workspace.data?.settings.timeZone ?? 'Europe/London').slice(0, 7);
  const statements = useStatements(orgId, thisMonth);
  const dueOf = new Map((statements.data?.statements ?? []).map((s) => [s.ownerId, s.netMinor]));
  const money = (minor: number) =>
    moneyText(minor, statements.data?.currency ?? 'GBP', workspace.data?.settings.locale ?? 'en-GB');
  const [inviting, setInviting] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const needle = q.trim().toLowerCase();
  const owners = useMemo(
    () =>
      data.owners.filter(
        (o) =>
          (filter === 'all' || (filter === 'setup' ? needsSetup(o) : accessOf(o) === filter)) &&
          (!needle ||
            [o.name, o.company, o.email, ...o.homes.map((h) => h.name)].some((v) =>
              v?.toLowerCase().includes(needle),
            )),
      ),
    [data.owners, filter, needle],
  );
  const unowned = data.unowned.filter((h) => !needle || h.name.toLowerCase().includes(needle));
  const owned = data.owners.reduce((t, o) => t + o.homes.length, 0);
  const canLogIn = data.owners.filter((o) => o.logins.length).length;
  const many = data.owners.filter((o) => o.homes.length > 1).length;

  return (
    <div className="flex flex-col gap-8">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ['Owners', data.owners.length, many ? `${many} with more than one home` : null],
            ['Homes with an owner', owned, null],
            [
              'Homes without one',
              data.unowned.length,
              data.unowned.length ? 'Give each to an owner below' : 'All done',
            ],
            ['Still to set up', data.owners.filter(needsSetup).length, 'Contract or a home’s deal missing'],
          ] as const
        ).map(([label, value, sub]) => (
          <div key={label} className="rounded-2xl border border-hairline bg-canvas px-4 py-3">
            <dt className="text-[12.5px] text-slate">{label}</dt>
            <dd className="mt-0.5 text-[22px] font-semibold tracking-[-0.02em] text-ink tnum">{value}</dd>
            {sub ? <dd className="text-[12px] text-slate">{sub}</dd> : null}
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1 sm:max-w-[320px]">
          <IconSearch
            size={15}
            stroke={1.75}
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-mist"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find an owner or a home"
            aria-label="Find an owner or a home"
            className="h-9 w-full rounded-full border border-hairline bg-canvas pr-3 pl-8 text-[14px] focus:border-accent focus:outline-none"
          />
        </label>
        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="sr-only">Show</legend>
          {FILTERS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              aria-pressed={filter === v}
              onClick={() => setFilter(v)}
              className={`h-8 rounded-full border px-3 text-[13px] ${filter === v ? 'border-ink bg-ink text-canvas' : 'border-hairline text-ink hover:border-edge'}`}
            >
              {label}
            </button>
          ))}
        </fieldset>
        {write && data.owners.length ? (
          <Button className="ml-auto" onClick={() => setInviting(true)}>
            Invite owners to log in
          </Button>
        ) : null}
      </div>

      {inviting ? <InviteOwnersSheet owners={data.owners} onClose={() => setInviting(false)} /> : null}

      {data.owners.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-hairline px-5 py-10 text-center text-[14px] text-slate">
          No owners yet. Add one and choose their homes, or bring them across from Guesty with the import.
        </p>
      ) : owners.length === 0 ? (
        <p className="text-[14px] text-slate">No owner matches.</p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-hairline bg-canvas">
          <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1.8fr)_70px_110px] gap-4 border-b border-hairline px-4 py-2 text-[12px] text-slate md:grid">
            <span>Owner</span>
            <span>Homes</span>
            <span className="text-right">Due in {monthName(thisMonth).split(' ')[0]} so far</span>
            <span className="text-right">Status</span>
          </div>
          <ul className="divide-y divide-hairline">
            {owners.map((o) => {
              const a = ACCESS[accessOf(o)];
              return (
                <li key={o.id}>
                  <Link
                    to={`/owners/${o.id}`}
                    className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-paper md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.8fr)_70px_110px]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[14.5px] font-medium text-ink">{o.name}</span>
                      <span className="block truncate text-[12.5px] text-slate">
                        {o.company ?? o.email ?? o.phone ?? 'No contact yet'}
                      </span>
                    </span>
                    <span className="min-w-0 max-md:col-span-2 max-md:row-start-2">
                      <span className="mr-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-accent-tint px-2 text-[12px] font-medium text-accent tnum">
                        {o.homes.length}
                      </span>
                      <span className="text-[13px] text-slate">{homesLine(o)}</span>
                    </span>
                    <span className="hidden text-right text-[13.5px] text-ink tnum md:block">
                      {dueOf.has(o.id) ? money(dueOf.get(o.id) as number) : '…'}
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      {needsSetup(o) ? (
                        <span className="rounded-full bg-pending/15 px-2 py-0.5 text-[12px] whitespace-nowrap text-pending-text">
                          {!o.setup.contract ? 'No contract' : `${o.setup.homesWithoutTerms} without a deal`}
                        </span>
                      ) : null}
                      <span className={`rounded-full px-2 py-0.5 text-[12px] whitespace-nowrap ${a.tone}`}>
                        {a.label}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {data.unowned.length ? (
        <section aria-labelledby="unowned">
          <h2 id="unowned" className="text-[16px] font-medium text-ink">
            Homes without an owner <span className="text-slate tnum">({data.unowned.length})</span>
          </h2>
          <p className="mb-3 text-[13px] text-slate">
            Statements and the owner log-in need each home tied to its owner.
            {write ? ' Choose one here, or tick several on an owner’s page.' : ''}
          </p>
          {unowned.length === 0 ? (
            <p className="text-[14px] text-slate">No home without an owner matches.</p>
          ) : (
            <ul className="grid gap-x-6 sm:grid-cols-2">
              {(showAll || needle ? unowned : unowned.slice(0, 12)).map((h) => (
                <UnownedHome key={h.id} home={h} owners={data.owners} write={write} />
              ))}
            </ul>
          )}
          {!showAll && !needle && unowned.length > 12 ? (
            <button type="button" className="action mt-2 -ml-2.5" onClick={() => setShowAll(true)}>
              Show all {unowned.length}
            </button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function UnownedHome({
  home,
  owners,
  write,
}: {
  home: { id: string; name: string };
  owners: Owner[];
  write: boolean;
}) {
  const { orgId } = useCurrentWorkspace();
  const give = useGiveHome(orgId);
  return (
    <li className="flex items-center justify-between gap-3 border-b border-hairline py-2.5 text-[14px]">
      <span className="min-w-0 truncate text-ink">{home.name}</span>
      {write && owners.length ? (
        <select
          aria-label={`Owner of ${home.name}`}
          value=""
          disabled={give.isPending}
          onChange={(e) => give.mutate({ propertyId: home.id, ownerId: e.target.value })}
          className="h-8 max-w-[180px] shrink-0 rounded-lg border border-hairline bg-canvas px-2 text-[13px] text-ink"
        >
          <option value="">Give to…</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      ) : null}
      {give.error ? <span className="text-[12px] text-urgent">{explain(give.error)}</span> : null}
    </li>
  );
}

/** Invite many owners at once, each at the email on their record. */
function InviteOwnersSheet({ owners, onClose }: { owners: Owner[]; onClose(): void }) {
  const { orgId } = useCurrentWorkspace();
  const invite = useInviteOwners(orgId);
  const ready = owners.filter((o) => o.email && accessOf(o) === 'none' && o.homes.length);
  const [picked, setPicked] = useState(new Set(ready.map((o) => o.id)));
  const [result, setResult] = useState<OwnerLoginBulkResult | null>(null);
  return (
    <Sheet
      title="Invite owners to log in"
      subtitle="Each gets an email with a sign-in link. No password to set."
      onClose={onClose}
      busy={invite.isPending}
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button
              variant="primary"
              disabled={!picked.size || invite.isPending}
              onClick={() => invite.mutate({ ownerIds: [...picked] }, { onSuccess: setResult })}
            >
              Invite {picked.size} {picked.size === 1 ? 'owner' : 'owners'}
            </Button>
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-3">
          <Notice tone="done">
            {result.invited === 1 ? 'One owner is' : `${result.invited} owners are`} invited.
          </Notice>
          {result.skipped.length ? (
            <ul className="text-[13.5px] text-slate">
              {result.skipped.map((s) => (
                <li key={s.name}>
                  <span className="text-ink">{s.name}</span>: {s.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <ul className="divide-y divide-hairline border-y border-hairline">
          {owners.map((o) => {
            const a = accessOf(o);
            const can = Boolean(o.email) && a === 'none';
            return (
              <li key={o.id}>
                <label
                  className={`flex items-center gap-3 px-1 py-2.5 text-[14px] ${can ? 'cursor-pointer hover:bg-paper' : 'opacity-60'}`}
                >
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-accent)]"
                    disabled={!can}
                    checked={picked.has(o.id)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      if (e.target.checked) next.add(o.id);
                      else next.delete(o.id);
                      setPicked(next);
                    }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{o.name}</span>
                    <span className="block truncate text-[12.5px] text-slate">
                      {!o.email
                        ? 'No email on their record: add one on their page'
                        : a === 'in'
                          ? `Can log in · ${o.email}`
                          : a === 'invited'
                            ? `Invited · ${o.email}`
                            : `${o.email} · ${o.homes.length} ${o.homes.length === 1 ? 'home' : 'homes'}`}
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {invite.error ? (
        <div className="mt-3">
          <Notice tone="urgent">{explain(invite.error)}</Notice>
        </div>
      ) : null}
    </Sheet>
  );
}
