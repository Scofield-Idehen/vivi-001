import { IconArrowLeft, IconMail, IconPhone } from '@tabler/icons-react';
import { can, EXPENSE_CATEGORY_LABELS, todayIn } from '@v01/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { MonthPicker, monthName } from '../../components/MonthPicker.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import {
  ApiError,
  useOwnerHomes,
  useOwnerMonth,
  useOwners,
  useProperties,
  useRemoveOwner,
  useWorkspace,
} from '../../lib/api.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { NotFound } from '../misc.tsx';
import { moneyText } from '../properties/money.ts';
import { feeText, OwnerSheet } from './OwnersPage.tsx';

/**
 * One owner: how to reach them, their homes, and their month: what each home earned (each booking
 * spread over the nights it covers), the fee, the expenses charged to them, and what's left for them.
 */

const explain = (e: unknown) => (e instanceof ApiError ? e.message : 'That didn’t go through. Try again.');
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const at = (d: string) => new Date(`${d}T12:00:00`);

function HomesSheet({ ownerId, chosen, onClose }: { ownerId: string; chosen: string[]; onClose(): void }) {
  const { orgId } = useCurrentWorkspace();
  const properties = useProperties(orgId);
  const owners = useOwners(orgId);
  const save = useOwnerHomes(orgId, ownerId);
  const [picked, setPicked] = useState(new Set(chosen));
  const ownerOf = new Map((owners.data?.owners ?? []).flatMap((o) => o.homes.map((h) => [h.id, o] as const)));
  return (
    <Sheet
      title="Their homes"
      subtitle="Tick every home they own"
      onClose={onClose}
      busy={save.isPending}
      footer={
        <>
          <Button
            variant="primary"
            disabled={save.isPending}
            onClick={() => save.mutate([...picked], { onSuccess: onClose })}
          >
            Save
          </Button>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
        </>
      }
    >
      <ul className="divide-y divide-hairline border-y border-hairline">
        {(properties.data?.properties ?? []).map((p) => {
          const other = ownerOf.get(p.id);
          return (
            <li key={p.id}>
              <label className="flex cursor-pointer items-center gap-3 px-1 py-3 hover:bg-paper">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--color-accent)]"
                  checked={picked.has(p.id)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(p.id);
                    else next.delete(p.id);
                    setPicked(next);
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] text-ink">{p.name}</span>
                  {other && other.id !== ownerId ? (
                    <span className="block text-[12.5px] text-pending-text">
                      Now {other.name}’s{picked.has(p.id) ? '; moves to this owner' : ''}
                    </span>
                  ) : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {save.error ? (
        <div className="mt-3">
          <Notice tone="urgent">{explain(save.error)}</Notice>
        </div>
      ) : null}
    </Sheet>
  );
}

export function OwnerPage() {
  const { id } = useParams();
  const { orgId, entry } = useCurrentWorkspace();
  const workspace = useWorkspace(orgId);
  const locale = workspace.data?.settings.locale ?? 'en-GB';
  const thisMonth = todayIn(workspace.data?.settings.timeZone ?? 'Europe/London').slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const data = useOwnerMonth(orgId, id ?? null, month);
  const remove = useRemoveOwner(orgId, id ?? '');
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const write = can(entry.role, 'owners.write');

  if (data.error instanceof ApiError && data.error.status === 404) return <NotFound />;
  const d = data.data;
  const o = d?.owner;
  const m = (minor: number) => moneyText(minor, d?.currency ?? 'GBP', locale);

  return (
    <>
      <Link to="/owners" className="action -ml-2.5 mb-4 inline-flex items-center gap-1">
        <IconArrowLeft size={15} stroke={1.75} aria-hidden /> Owners
      </Link>
      {!d || !o ? (
        data.isPending ? (
          <Spinner size={16} />
        ) : (
          <Notice tone="urgent">{explain(data.error)}</Notice>
        )
      ) : (
        <>
          {editing ? <OwnerSheet owner={o} onClose={() => setEditing(false)} /> : null}
          {choosing ? (
            <HomesSheet ownerId={o.id} chosen={o.homes.map((h) => h.id)} onClose={() => setChoosing(false)} />
          ) : null}
          <header className="mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-6">
            <div className="min-w-0">
              <h1 className="text-[26px] leading-[1.2] font-semibold tracking-[-0.02em] text-ink">
                {o.name}
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] text-slate">
                {o.company ? <span>{o.company}</span> : null}
                <span>Fee {feeText(o.feeBasisPoints)}</span>
                {o.email ? (
                  <a href={`mailto:${o.email}`} className="action -mx-2.5 inline-flex items-center gap-1.5">
                    <IconMail size={15} stroke={1.75} aria-hidden /> {o.email}
                  </a>
                ) : null}
                {o.phone ? (
                  <a
                    href={`tel:${o.phone.replace(/\s/g, '')}`}
                    className="action -mx-2.5 inline-flex items-center gap-1.5"
                  >
                    <IconPhone size={15} stroke={1.75} aria-hidden /> {o.phone}
                  </a>
                ) : null}
              </p>
            </div>
            {write ? (
              <div className="flex gap-2">
                <Button onClick={() => setEditing(true)}>Edit</Button>
                <Button
                  variant="quiet"
                  className="action-urgent"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Remove ${o.name}? Their homes stay, with no owner recorded.`))
                      remove.mutate(undefined, { onSuccess: () => navigate('/owners') });
                  }}
                >
                  Remove
                </Button>
              </div>
            ) : null}
          </header>
          {o.notes ? (
            <p className="mb-6 max-w-[70ch] text-[14px] leading-relaxed text-slate">{o.notes}</p>
          ) : null}

          <section aria-labelledby="month" className={data.isPlaceholderData ? 'opacity-60' : ''}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 id="month" className="text-[20px] font-semibold tracking-[-0.015em] text-ink">
                {monthName(d.month)}
              </h2>
              <MonthPicker value={month} onChange={setMonth} />
            </div>

            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {(
                [
                  ['Earned', d.earnedMinor, null],
                  [`Fee (${feeText(o.feeBasisPoints)})`, -d.feeMinor, null],
                  ['Expenses charged', -d.expensesMinor, null],
                  ['To the owner', d.netMinor, 'net'],
                ] as const
              ).map(([label, value, tone]) => (
                <div
                  key={label}
                  className={`rounded-xl border p-4 ${tone ? 'border-accent bg-accent-tint/30' : 'border-hairline bg-canvas'}`}
                >
                  <p className="text-[22px] leading-tight font-semibold tracking-[-0.015em] text-ink tnum">
                    {value < 0 ? `− ${m(-value)}` : m(value)}
                  </p>
                  <p className="mt-0.5 text-[13.5px] text-slate">{label}</p>
                </div>
              ))}
            </div>

            <div className="grid items-start gap-6 lg:grid-cols-2">
              <div className="rounded-2xl border border-hairline bg-canvas p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Their homes</h3>
                  {write ? (
                    <button type="button" className="action -mr-2.5" onClick={() => setChoosing(true)}>
                      Choose homes
                    </button>
                  ) : null}
                </div>
                {d.homes.length ? (
                  <table className="w-full text-[14px]">
                    <thead>
                      <tr className="text-left text-[12.5px] text-slate">
                        <th className="pb-2 font-normal">Home</th>
                        <th className="pb-2 text-right font-normal">Nights</th>
                        <th className="pb-2 text-right font-normal">Earned</th>
                        <th className="pb-2 text-right font-normal">Expenses</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline border-t border-hairline">
                      {d.homes.map((h) => (
                        <tr key={h.id}>
                          <td className="py-2.5">
                            <Link to={`/properties/${h.id}`} className="text-ink hover:text-accent">
                              {h.name}
                            </Link>
                          </td>
                          <td className="py-2.5 text-right text-slate tnum">{h.nights}</td>
                          <td className="py-2.5 text-right text-ink tnum">{m(h.earnedMinor)}</td>
                          <td className="py-2.5 text-right text-ink tnum">
                            {h.expensesMinor ? m(h.expensesMinor) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-[14px] text-slate">No homes chosen yet.</p>
                )}
                <p className="mt-3 text-[12px] text-mist">
                  Confirmed bookings, each spread over the nights it covers.
                </p>
              </div>

              <div className="rounded-2xl border border-hairline bg-canvas p-5">
                <h3 className="mb-3 text-[17px] font-semibold tracking-[-0.015em] text-ink">
                  Charged to them
                </h3>
                {d.expenses.length ? (
                  <ul className="divide-y divide-hairline border-y border-hairline">
                    {d.expenses.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-4 py-2.5 text-[14px]">
                        <span className="min-w-0">
                          <span className="block truncate text-ink">{e.description}</span>
                          <span className="block truncate text-[12.5px] text-slate">
                            {DAY.format(at(e.spentOn))} · {e.propertyName} ·{' '}
                            {EXPENSE_CATEGORY_LABELS[e.category]}
                            {e.receipt ? ' · receipt kept' : ''}
                          </span>
                        </span>
                        <span className="shrink-0 text-ink tnum">{m(e.amountMinor)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[14px] text-slate">Nothing charged to them this month.</p>
                )}
                <Link to={`/expenses?month=${d.month}`} className="action -ml-2.5 mt-3 inline-flex">
                  All expenses
                </Link>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}
