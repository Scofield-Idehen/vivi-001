import { IconPaperclip } from '@tabler/icons-react';
import {
  can,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type Expense,
  type ExpenseCategory,
  todayIn,
} from '@v01/shared';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { SelectField } from '../../components/fields.tsx';
import { MonthPicker, monthName } from '../../components/MonthPicker.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import { Button, Notice, PageHeader } from '../../components/ui.tsx';
import { ApiError, useExpenses, useProperties, useWorkspace } from '../../lib/api.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { moneyText } from '../properties/money.ts';
import { ExpenseSheet } from './ExpenseSheet.tsx';

/**
 * Expenses (built 30 Oct 2026): money spent on the homes, month by month. What each cost, who
 * bears it (the owner, or the company), and the receipt. Owners' months take the ones charged to them.
 */

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const at = (d: string) => new Date(`${d}T12:00:00`);

export function ExpensesPage() {
  const { orgId, entry } = useCurrentWorkspace();
  const workspace = useWorkspace(orgId);
  const locale = workspace.data?.settings.locale ?? 'en-GB';
  const [params, setParams] = useSearchParams();
  const thisMonth = todayIn(workspace.data?.settings.timeZone ?? 'Europe/London').slice(0, 7);
  const month = params.get('month') ?? thisMonth;
  const propertyId = params.get('home') ?? '';
  const category = params.get('kind') ?? '';
  const list = useExpenses(orgId, month, { propertyId, category });
  const properties = useProperties(orgId);
  const write = can(entry.role, 'expenses.write');
  const [open, setOpen] = useState<Expense | 'new' | null>(null);
  const d = list.data;
  const m = (minor: number) => moneyText(minor, d?.currency ?? 'GBP', locale);
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Money spent on the homes, with receipts. Charged to the owner, or kept by the company."
        action={
          write ? (
            <Button variant="primary" onClick={() => setOpen('new')}>
              Add an expense
            </Button>
          ) : undefined
        }
      />
      {open ? (
        <ExpenseSheet
          key={open === 'new' ? 'new' : open.id}
          expense={open === 'new' ? undefined : open}
          start={open === 'new' && propertyId ? { propertyId } : undefined}
          onClose={() => setOpen(null)}
        />
      ) : null}

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <MonthPicker value={month} onChange={(v) => set('month', v === thisMonth ? '' : v)} />
        <div className="w-[220px]">
          <SelectField
            label="Home"
            value={propertyId}
            onChange={(v) => set('home', v)}
            options={[
              { value: '', label: 'Every home' },
              ...(properties.data?.properties ?? []).map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </div>
        <div className="w-[220px]">
          <SelectField
            label="Kind"
            value={category}
            onChange={(v) => set('kind', v)}
            options={[
              { value: '', label: 'Every kind' },
              ...EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABELS[c] })),
            ]}
          />
        </div>
      </div>

      {list.isPending ? (
        <Spinner size={16} />
      ) : list.error && !d ? (
        <Notice tone="urgent">
          {list.error instanceof ApiError ? list.error.message : 'Expenses couldn’t be loaded.'}
        </Notice>
      ) : d ? (
        <div className={`flex flex-col gap-6 ${list.isPlaceholderData ? 'opacity-60' : ''}`}>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              [`Spent in ${monthName(d.month)}`, d.totalMinor],
              ['Charged to owners', d.ownerMinor],
              ['Kept by the company', d.companyMinor],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-xl border border-hairline bg-canvas p-3 sm:p-4">
                <p className="text-[16px] leading-tight font-semibold tracking-[-0.015em] text-ink tnum sm:text-[22px]">
                  {m(value as number)}
                </p>
                <p className="mt-0.5 text-[12px] leading-snug text-slate sm:text-[13.5px]">{label}</p>
              </div>
            ))}
          </div>

          {d.byCategory.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {d.byCategory.map((c) => (
                <button
                  key={c.category}
                  type="button"
                  aria-pressed={category === c.category}
                  onClick={() => set('kind', category === c.category ? '' : c.category)}
                  className="inline-flex h-8 items-center gap-2 rounded-full border border-hairline bg-canvas px-3 text-[13px] text-ink hover:border-edge aria-pressed:border-ink"
                >
                  {EXPENSE_CATEGORY_LABELS[c.category as ExpenseCategory]}
                  <span className="font-semibold tnum">{m(c.amountMinor)}</span>
                </button>
              ))}
            </div>
          ) : null}

          {d.expenses.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-hairline px-5 py-10 text-center text-[14px] text-slate">
              Nothing spent{propertyId || category ? ' that matches' : ''} in {monthName(d.month)}.
            </p>
          ) : (
            <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-canvas">
              {d.expenses.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() =>
                      write ? setOpen(e) : e.receipt && window.open(e.receipt.url, '_blank', 'noopener')
                    }
                    disabled={!write && !e.receipt}
                    className="grid w-full grid-cols-[52px_1fr_auto] items-center gap-x-4 px-4 py-3 text-left transition-colors enabled:hover:bg-paper sm:grid-cols-[52px_minmax(0,2fr)_minmax(0,1fr)_auto]"
                  >
                    <span className="text-[13px] text-slate tnum">{DAY.format(at(e.spentOn))}</span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 truncate text-[14.5px] text-ink">
                        {e.description}
                        {e.receipt ? (
                          <IconPaperclip
                            size={14}
                            stroke={1.75}
                            aria-label="Receipt kept"
                            className="shrink-0 text-mist"
                          />
                        ) : null}
                      </span>
                      <span className="block truncate text-[13px] text-slate">
                        {e.propertyName ?? 'The business'}
                        {e.vendor ? ` · ${e.vendor}` : ''} · {EXPENSE_CATEGORY_LABELS[e.category]}
                      </span>
                    </span>
                    <span className="text-[12.5px] text-slate max-sm:hidden">
                      {e.chargeTo === 'owner' ? `To ${e.ownerName ?? 'the owner'}` : 'Company'}
                    </span>
                    <span className="text-right text-[14.5px] text-ink tnum">{m(e.amountMinor)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </>
  );
}
