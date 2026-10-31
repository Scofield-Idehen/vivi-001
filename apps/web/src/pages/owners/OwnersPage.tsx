import { can, type Owner, type StatementStatus, todayIn } from '@v01/shared';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { TextArea, TextField } from '../../components/fields.tsx';
import { MonthPicker, monthName, shiftMonth } from '../../components/MonthPicker.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import { Button, Notice, PageHeader } from '../../components/ui.tsx';
import {
  ApiError,
  useCreateOwner,
  useOwners,
  useStatements,
  useUpdateOwner,
  useWorkspace,
} from '../../lib/api.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { moneyText } from '../properties/money.ts';

/**
 * Owners (built 30 Oct 2026): whose homes the team runs, how to reach them, and the management
 * fee. Each owner's page shows their homes and their month, the draft of their statement.
 */

const explain = (e: unknown) => (e instanceof ApiError ? e.message : 'That didn’t go through. Try again.');
export const feeText = (bp: number) => `${(bp / 100).toFixed(bp % 100 ? 1 : 0)}%`;

/** Adding an owner, or changing one. */
export function OwnerSheet({ owner, onClose }: { owner?: Owner; onClose(saved?: Owner): void }) {
  const { orgId } = useCurrentWorkspace();
  const create = useCreateOwner(orgId);
  const update = useUpdateOwner(orgId, owner?.id ?? '');
  const save = owner ? update : create;
  const [name, setName] = useState(owner?.name ?? '');
  const [company, setCompany] = useState(owner?.company ?? '');
  const [email, setEmail] = useState(owner?.email ?? '');
  const [phone, setPhone] = useState(owner?.phone ?? '');
  const [fee, setFee] = useState(owner ? String(owner.feeBasisPoints / 100) : '20');
  const [notes, setNotes] = useState(owner?.notes ?? '');
  const feeNumber = Number(fee.replace('%', '').trim() || '0');
  const feeOk = Number.isFinite(feeNumber) && feeNumber >= 0 && feeNumber <= 100;
  const emailOk = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const ready = name.trim().length > 0 && feeOk && emailOk;
  return (
    <Sheet
      title={owner ? 'Owner' : 'Add an owner'}
      onClose={() => onClose()}
      busy={save.isPending}
      footer={
        <>
          <Button
            variant="primary"
            disabled={!ready || save.isPending}
            onClick={() =>
              save.mutate(
                {
                  name: name.trim(),
                  company,
                  email: email.trim(),
                  phone,
                  feeBasisPoints: Math.round(feeNumber * 100),
                  notes,
                },
                { onSuccess: (o) => onClose(o) },
              )
            }
          >
            {owner ? 'Save' : 'Add owner'}
          </Button>
          <Button variant="quiet" onClick={() => onClose()}>
            Cancel
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <TextField label="Name" value={name} onChange={setName} max={120} placeholder="Tom Ellis" />
        <TextField
          label="Company"
          value={company}
          onChange={setCompany}
          max={120}
          placeholder="If they own through one"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Email"
            value={email}
            onChange={setEmail}
            autoComplete="off"
            error={emailOk ? undefined : 'An email like name@example.com.'}
          />
          <TextField label="Phone" value={phone} onChange={setPhone} max={40} autoComplete="off" />
        </div>
        <div className="max-w-[200px]">
          <TextField
            label="Management fee (%)"
            value={fee}
            onChange={setFee}
            error={feeOk ? undefined : 'A percentage from 0 to 100.'}
            hint="Of what their homes earn."
          />
        </div>
        <TextArea
          label="Notes"
          value={notes}
          onChange={setNotes}
          max={2000}
          rows={3}
          placeholder="How they like to be paid, when to call…"
        />
        {save.error ? <Notice tone="urgent">{explain(save.error)}</Notice> : null}
      </div>
    </Sheet>
  );
}

export function OwnersPage() {
  const { orgId, entry } = useCurrentWorkspace();
  const list = useOwners(orgId);
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const write = can(entry.role, 'owners.write');
  const d = list.data;
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'statements' ? 'statements' : 'owners';
  return (
    <>
      <PageHeader
        title="Owners"
        description="Whose homes you run, how to reach them, and your fee. Open one for their homes and their month."
        action={
          write ? (
            <Button variant="primary" onClick={() => setAdding(true)}>
              Add an owner
            </Button>
          ) : undefined
        }
      />
      {adding ? (
        <OwnerSheet
          onClose={(o) => {
            setAdding(false);
            if (o) navigate(`/owners/${o.id}`);
          }}
        />
      ) : null}
      <div role="tablist" aria-label="Owners or statements" className="mb-5 flex gap-2">
        {(
          [
            ['owners', 'Owners'],
            ['statements', 'Statements'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setParams(v === 'owners' ? {} : { view: v }, { replace: true })}
            className={`h-9 rounded-full border px-4 text-[13.5px] transition-colors ${view === v ? 'border-ink bg-ink text-canvas' : 'border-hairline text-ink hover:border-edge'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'statements' ? (
        <Statements />
      ) : list.isPending ? (
        <Spinner size={16} />
      ) : !d ? (
        <Notice tone="urgent">{explain(list.error)}</Notice>
      ) : (
        <div className="flex flex-col gap-6">
          {d.owners.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-hairline px-5 py-10 text-center text-[14px] text-slate">
              No owners yet. Add one, then choose which homes are theirs.
            </p>
          ) : (
            <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-canvas">
              {d.owners.map((o) => (
                <li key={o.id}>
                  <Link
                    to={`/owners/${o.id}`}
                    className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 transition-colors hover:bg-paper sm:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_auto]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[14.5px] font-medium text-ink">{o.name}</span>
                      <span className="block truncate text-[13px] text-slate">
                        {o.company ?? o.email ?? o.phone ?? 'No contact yet'}
                      </span>
                    </span>
                    <span className="truncate text-[13px] text-slate max-sm:col-span-2 max-sm:row-start-2">
                      {o.homes.length ? o.homes.map((h) => h.name).join(', ') : 'No homes chosen yet'}
                    </span>
                    <span className="text-right text-[13px] text-ink tnum">
                      {o.homes.length} {o.homes.length === 1 ? 'home' : 'homes'} · {feeText(o.feeBasisPoints)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {d.unowned.length ? (
            <p className="text-[13.5px] text-slate">
              No owner recorded for {d.unowned.length === 1 ? 'one home' : `${d.unowned.length} homes`}:{' '}
              {d.unowned.map((h) => h.name).join(', ')}.
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}

const STATUS: Record<StatementStatus, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'text-pending-text' },
  final: { label: 'Finalised', tone: 'text-accent' },
  paid: { label: 'Paid', tone: 'text-done-text' },
};

/** The month's run: every owner, what's due to them, and how far each statement has got. */
function Statements() {
  const { orgId } = useCurrentWorkspace();
  const workspace = useWorkspace(orgId);
  const locale = workspace.data?.settings.locale ?? 'en-GB';
  // Statements are for a month that has ended: start on last month.
  const thisMonth = todayIn(workspace.data?.settings.timeZone ?? 'Europe/London').slice(0, 7);
  const [month, setMonth] = useState(shiftMonth(thisMonth, -1));
  const list = useStatements(orgId, month);
  const d = list.data;
  const m = (minor: number) => moneyText(minor, d?.currency ?? 'GBP', locale);
  const left = d ? d.statements.filter((x) => x.status !== 'paid' && x.homes > 0).length : 0;
  return (
    <section aria-label="Statements">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <MonthPicker value={month} onChange={setMonth} />
        {d ? (
          <p className="text-[13.5px] text-slate">
            {left ? `${left} still to finalise or pay` : 'All paid'} · {m(d.totals.netMinor)} due to owners in{' '}
            {monthName(d.month)}
          </p>
        ) : null}
      </div>
      {!d ? (
        list.isPending ? (
          <Spinner size={16} />
        ) : (
          <Notice tone="urgent">{explain(list.error)}</Notice>
        )
      ) : d.statements.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-hairline px-5 py-10 text-center text-[14px] text-slate">
          No owners yet.
        </p>
      ) : (
        <div
          className={`overflow-x-auto rounded-2xl border border-hairline bg-canvas ${list.isPlaceholderData ? 'opacity-60' : ''}`}
        >
          <table className="w-full min-w-[640px] text-[14px]">
            <thead>
              <tr className="border-b border-hairline text-left text-[12.5px] text-slate">
                <th className="px-4 py-2.5 font-normal">Owner</th>
                <th className="px-4 py-2.5 text-right font-normal">Earned</th>
                <th className="px-4 py-2.5 text-right font-normal">Fee</th>
                <th className="px-4 py-2.5 text-right font-normal">Expenses</th>
                <th className="px-4 py-2.5 text-right font-normal">Due to them</th>
                <th className="px-4 py-2.5 font-normal">Statement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {d.statements.map((x) => (
                <tr key={x.ownerId} className="hover:bg-paper">
                  <td className="px-4 py-3">
                    <Link
                      to={`/owners/${x.ownerId}?month=${d.month}`}
                      className="font-medium text-ink hover:text-accent"
                    >
                      {x.ownerName}
                    </Link>
                    <span className="block text-[12.5px] text-slate">
                      {x.homes} {x.homes === 1 ? 'home' : 'homes'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-ink tnum">{m(x.earnedMinor)}</td>
                  <td className="px-4 py-3 text-right text-slate tnum">{m(x.feeMinor)}</td>
                  <td className="px-4 py-3 text-right text-slate tnum">{m(x.expensesMinor)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-ink tnum">{m(x.netMinor)}</td>
                  <td className={`px-4 py-3 text-[13px] font-medium ${STATUS[x.status].tone}`}>
                    {STATUS[x.status].label}
                    {x.paidOn ? (
                      <span className="block text-[12px] font-normal text-slate">
                        {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(
                          new Date(`${x.paidOn}T12:00:00`),
                        )}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-hairline font-semibold">
                <td className="px-4 py-3 text-ink">Total</td>
                <td className="px-4 py-3 text-right text-ink tnum">{m(d.totals.earnedMinor)}</td>
                <td className="px-4 py-3 text-right text-ink tnum">{m(d.totals.feeMinor)}</td>
                <td className="px-4 py-3 text-right text-ink tnum">{m(d.totals.expensesMinor)}</td>
                <td className="px-4 py-3 text-right text-ink tnum">{m(d.totals.netMinor)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="mt-2 text-[12px] text-mist">
        Drafts are worked out live; open an owner to finalise, print or mark it paid.
      </p>
    </section>
  );
}
