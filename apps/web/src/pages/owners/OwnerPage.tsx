import { IconArrowLeft, IconMail, IconPhone, IconPrinter } from '@tabler/icons-react';
import { CHANNEL_LABELS, can, EXPENSE_CATEGORY_LABELS, type OwnerMonth, todayIn } from '@v01/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { DateField } from '../../components/DateField.tsx';
import { TextField } from '../../components/fields.tsx';
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
  useStatementAction,
  useWorkspace,
} from '../../lib/api.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { NotFound } from '../misc.tsx';
import { moneyText } from '../properties/money.ts';
import { feeText, OwnerSheet } from './OwnersPage.tsx';
import { StatementDocument } from './StatementDocument.tsx';

/**
 * One owner: how to reach them, their homes, and their month: what each home earned (each booking
 * spread over the nights it covers), the fee, the expenses charged to them, and what's left for them.
 */

const explain = (e: unknown) => (e instanceof ApiError ? e.message : 'That didn’t go through. Try again.');
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const at = (d: string) => new Date(`${d}T12:00:00`);
const STAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

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

/**
 * Where the month's statement stands: a draft worked out live, finalised (the figures are kept as
 * they were), or paid. Print opens the browser's print dialog on the statement alone, where it can
 * be saved as a PDF to send.
 */
function StatementBar({
  m,
  write,
  locale,
  from,
}: {
  m: OwnerMonth;
  write: boolean;
  locale: string;
  from: string;
}) {
  const { orgId } = useCurrentWorkspace();
  const act = useStatementAction(orgId, m.owner.id, m.month);
  const workspace = useWorkspace(orgId);
  const today = todayIn(workspace.data?.settings.timeZone ?? 'Europe/London');
  const [paying, setPaying] = useState(false);
  const [paidOn, setPaidOn] = useState(today);
  const [reference, setReference] = useState('');
  const s = m.statement;
  const LONG = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });
  return (
    <div className="mb-5 rounded-xl border border-hairline bg-paper px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-ink">
          {s === null ? (
            <>
              <span className="font-semibold">Draft.</span>{' '}
              <span className="text-slate">
                Worked out live from bookings and expenses until you finalise it.
              </span>
            </>
          ) : s.status === 'final' ? (
            <>
              <span className="font-semibold">Finalised</span>{' '}
              <span className="text-slate">
                {LONG.format(new Date(s.finalisedAt))}
                {s.finalisedBy ? ` by ${s.finalisedBy}` : ''}. These figures won’t change.
              </span>
            </>
          ) : (
            <>
              <span className="font-semibold text-done-text">Paid</span>{' '}
              <span className="text-slate">
                {s.paidOn ? LONG.format(new Date(`${s.paidOn}T12:00:00`)) : ''}
                {s.paidReference ? `, ref. ${s.paidReference}` : ''}
              </span>
            </>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => window.print()}>
            <IconPrinter size={16} stroke={1.75} aria-hidden /> Print or save PDF
          </Button>
          {write && s === null ? (
            <Button
              variant="primary"
              disabled={act.isPending}
              onClick={() => {
                if (window.confirm('Finalise this statement? Its figures are kept as they are now.'))
                  act.mutate({ kind: 'finalise' });
              }}
            >
              Finalise
            </Button>
          ) : null}
          {write && s?.status === 'final' ? (
            <>
              <Button variant="primary" onClick={() => setPaying(true)}>
                Mark paid
              </Button>
              <Button variant="quiet" disabled={act.isPending} onClick={() => act.mutate({ kind: 'reopen' })}>
                Reopen
              </Button>
            </>
          ) : null}
          {write && s?.status === 'paid' ? (
            <Button variant="quiet" disabled={act.isPending} onClick={() => act.mutate({ kind: 'unpaid' })}>
              Mark unpaid
            </Button>
          ) : null}
        </div>
      </div>
      {paying && s?.status === 'final' ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-hairline pt-3">
          <div className="w-[220px]">
            <DateField label="Paid on" value={paidOn} today={today} max={today} onChange={setPaidOn} />
          </div>
          <div className="w-[220px]">
            <TextField
              label="Reference"
              value={reference}
              onChange={setReference}
              max={120}
              placeholder="Bank reference"
            />
          </div>
          <Button
            variant="primary"
            disabled={act.isPending}
            onClick={() =>
              act.mutate(
                { kind: 'paid', paidOn, paidReference: reference.trim() || undefined },
                { onSuccess: () => setPaying(false) },
              )
            }
          >
            Save
          </Button>
          <Button variant="quiet" onClick={() => setPaying(false)}>
            Cancel
          </Button>
        </div>
      ) : null}
      {act.error ? (
        <div className="mt-3">
          <Notice tone="urgent">{explain(act.error)}</Notice>
        </div>
      ) : null}
      <div className="hidden print:block">
        <StatementDocument m={m} from={from} locale={locale} />
      </div>
    </div>
  );
}

export function OwnerPage() {
  const { id } = useParams();
  const { orgId, entry } = useCurrentWorkspace();
  const workspace = useWorkspace(orgId);
  const locale = workspace.data?.settings.locale ?? 'en-GB';
  const thisMonth = todayIn(workspace.data?.settings.timeZone ?? 'Europe/London').slice(0, 7);
  const [params, setParams] = useSearchParams();
  const month = params.get('month') ?? thisMonth;
  const setMonth = (v: string) => setParams(v === thisMonth ? {} : { month: v }, { replace: true });
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

            <StatementBar
              m={d}
              write={write}
              locale={locale}
              from={workspace.data?.brand.displayName ?? entry.organisationName}
            />

            <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {(
                [
                  ['Earned', d.earnedMinor, null],
                  [`Fee (${feeText(o.feeBasisPoints)})`, -d.feeMinor, null],
                  ['Expenses charged', -d.expensesMinor, null],
                  [d.netMinor < 0 ? 'Owed by the owner' : 'To the owner', d.netMinor, 'net'],
                ] as const
              ).map(([label, value, tone]) => (
                <div
                  key={label}
                  className={`rounded-xl border p-4 ${tone ? 'border-accent bg-accent-tint/30' : 'border-hairline bg-canvas'}`}
                >
                  <p className="text-[22px] leading-tight font-semibold tracking-[-0.015em] text-ink tnum">
                    {value < 0 ? `− ${m(-value)}` : m(Math.abs(value))}
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
            <div className="mt-6 rounded-2xl border border-hairline bg-canvas p-5">
              <h3 className="mb-3 text-[17px] font-semibold tracking-[-0.015em] text-ink">
                Stays this month
              </h3>
              {d.bookings.length ? (
                <ul className="divide-y divide-hairline border-y border-hairline">
                  {d.bookings.map((b) => (
                    <li key={b.reservationId}>
                      <Link
                        to={`/reservations/${b.reservationId}`}
                        className="grid grid-cols-[1fr_auto] items-center gap-x-4 py-2.5 text-[14px] hover:bg-paper sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto_auto]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-ink">{b.guestName ?? 'Guest'}</span>
                          <span className="block truncate text-[12.5px] text-slate">
                            {b.propertyName} · {CHANNEL_LABELS[b.channel]}
                          </span>
                        </span>
                        <span className="text-[13px] text-slate max-sm:hidden">
                          {STAY.format(new Date(`${b.checkIn}T12:00:00`))} –{' '}
                          {STAY.format(new Date(`${b.checkOut}T12:00:00`))}
                        </span>
                        <span className="text-right text-[13px] text-slate tnum max-sm:hidden">
                          {b.nights} {b.nights === 1 ? 'night' : 'nights'}
                        </span>
                        <span className="text-right text-ink tnum">{m(b.earnedMinor)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[14px] text-slate">No nights booked this month.</p>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
