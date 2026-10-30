import { IconFileTypePdf, IconPaperclip, IconPhoto } from '@tabler/icons-react';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type Expense,
  type ExpenseCategory,
  type ExpenseCharge,
  parseMajorToMinor,
  todayIn,
} from '@v01/shared';
import { useRef, useState } from 'react';
import { DateField } from '../../components/DateField.tsx';
import { MoneyField, SelectField, TextField } from '../../components/fields.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import {
  ApiError,
  useClaims,
  useProperties,
  useRemoveExpense,
  useRemoveReceipt,
  useSaveExpense,
  useWorkspace,
} from '../../lib/api.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { currencySymbol, minorToInput } from '../properties/money.ts';

const explain = (e: unknown) => (e instanceof ApiError ? e.message : 'That didn’t go through. Try again.');

/**
 * Recording money spent: on which home (or none, for the business), what for, how much, and who
 * bears it. The receipt is kept as chosen. From a claim, the home and the claim are filled in.
 */
export function ExpenseSheet({
  expense,
  start,
  onClose,
}: {
  expense?: Expense;
  start?: { propertyId?: string; claimId?: string; category?: ExpenseCategory; description?: string };
  onClose(): void;
}) {
  const { orgId } = useCurrentWorkspace();
  const workspace = useWorkspace(orgId);
  const properties = useProperties(orgId);
  const claims = useClaims(orgId, 'active');
  const save = useSaveExpense(orgId);
  const remove = useRemoveExpense(orgId);
  const removeReceipt = useRemoveReceipt(orgId);
  const locale = workspace.data?.settings.locale ?? 'en-GB';
  const currency = expense?.currency ?? workspace.data?.settings.currency ?? 'GBP';
  const today = todayIn(workspace.data?.settings.timeZone ?? 'Europe/London');
  const [propertyId, setPropertyId] = useState(expense?.propertyId ?? start?.propertyId ?? '');
  const [spentOn, setSpentOn] = useState(expense?.spentOn ?? today);
  const [description, setDescription] = useState(expense?.description ?? start?.description ?? '');
  const [category, setCategory] = useState<ExpenseCategory>(
    expense?.category ?? start?.category ?? 'supplies',
  );
  const [vendor, setVendor] = useState(expense?.vendor ?? '');
  const [amount, setAmount] = useState(minorToInput(expense?.amountMinor, currency));
  const [chargeTo, setChargeTo] = useState<ExpenseCharge>(expense?.chargeTo ?? 'owner');
  const [claimId, setClaimId] = useState(expense?.claimId ?? start?.claimId ?? '');
  const [receipt, setReceipt] = useState<File | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  let amountMinor: number | undefined;
  try {
    amountMinor = amount.trim() ? parseMajorToMinor(amount.replace(/[^\d.]/g, ''), currency) : undefined;
  } catch {
    amountMinor = undefined;
  }
  const homes = properties.data?.properties ?? [];
  const homeClaims = (claims.data?.claims ?? []).filter((c) => c.propertyId === propertyId);
  const ready =
    description.trim().length > 0 && amountMinor !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(spentOn);
  const error = save.error ?? remove.error ?? removeReceipt.error;

  return (
    <Sheet
      title={expense ? 'Expense' : 'Add an expense'}
      onClose={onClose}
      busy={save.isPending}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span className="flex gap-2">
            <Button
              variant="primary"
              disabled={!ready || save.isPending}
              onClick={() =>
                save.mutate(
                  {
                    id: expense?.id,
                    receipt,
                    body: {
                      spentOn,
                      category,
                      description: description.trim(),
                      vendor: vendor.trim() || null,
                      amountMinor: amountMinor ?? 0,
                      chargeTo: propertyId ? chargeTo : 'company',
                      propertyId: propertyId || null,
                      claimId: propertyId && claimId ? claimId : null,
                    },
                  },
                  { onSuccess: onClose },
                )
              }
            >
              {expense ? 'Save' : 'Add expense'}
            </Button>
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
          </span>
          {expense ? (
            <Button
              variant="quiet"
              className="action-urgent"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm('Remove this expense and its receipt?'))
                  remove.mutate(expense.id, { onSuccess: onClose });
              }}
            >
              Remove
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <SelectField
          label="For"
          value={propertyId}
          onChange={setPropertyId}
          options={[
            { value: '', label: 'Not for a home (the business)' },
            ...homes.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
        <TextField
          label="What"
          value={description}
          onChange={setDescription}
          max={300}
          placeholder="Restock: toiletries, coffee, bin bags"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <MoneyField
            label="Amount"
            value={amount}
            onChange={setAmount}
            symbol={currencySymbol(currency, locale)}
            error={amount.trim() && amountMinor === undefined ? 'An amount like 42 or 42.80.' : undefined}
          />
          <DateField label="Day" value={spentOn} today={today} max={today} onChange={setSpentOn} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Kind"
            value={category}
            onChange={(v) => setCategory(v as ExpenseCategory)}
            options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: EXPENSE_CATEGORY_LABELS[c] }))}
          />
          <TextField
            label="Paid to"
            value={vendor}
            onChange={setVendor}
            max={120}
            placeholder="Shop or tradesperson"
          />
        </div>
        {propertyId ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-[13px] text-slate">Who bears it</legend>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['owner', 'Charge to the owner'],
                  ['company', 'The company keeps it'],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={chargeTo === v}
                  onClick={() => setChargeTo(v)}
                  className={`h-9 rounded-full border px-4 text-[13.5px] ${chargeTo === v ? 'border-ink bg-ink text-canvas' : 'border-hairline text-ink hover:bg-linen'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-[12.5px] text-mist">
              {chargeTo === 'owner'
                ? 'Comes off what the owner is paid that month.'
                : 'Stays a cost of running the home; the owner isn’t charged.'}
            </p>
          </fieldset>
        ) : null}
        {propertyId && (homeClaims.length || claimId) ? (
          <SelectField
            label="For a damage claim"
            value={claimId}
            onChange={setClaimId}
            options={[
              { value: '', label: 'No' },
              ...homeClaims.map((c) => ({
                value: c.id,
                label: `${c.guestName ?? 'Guest'}, left ${c.checkOut}`,
              })),
              ...(claimId && !homeClaims.some((c) => c.id === claimId)
                ? [{ value: claimId, label: 'A claim no longer active' }]
                : []),
            ]}
            hint="It shows on the claim as money already spent putting it right."
          />
        ) : null}

        <div>
          <p className="mb-1.5 text-[13px] text-slate">Receipt</p>
          <input
            ref={picker}
            type="file"
            hidden
            accept="application/pdf,image/*"
            onChange={(e) => {
              setReceipt(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
          {receipt ? (
            <p className="flex items-center gap-2 text-[14px] text-ink">
              <IconPaperclip size={16} stroke={1.75} aria-hidden /> {receipt.name}
              <button type="button" className="action" onClick={() => setReceipt(null)}>
                Remove
              </button>
            </p>
          ) : expense?.receipt ? (
            <p className="flex flex-wrap items-center gap-2 text-[14px] text-ink">
              <a
                href={expense.receipt.url}
                target="_blank"
                rel="noreferrer"
                className="action -ml-2.5 inline-flex items-center gap-1.5"
              >
                {expense.receipt.contentType === 'application/pdf' ? (
                  <IconFileTypePdf size={16} stroke={1.75} aria-hidden />
                ) : (
                  <IconPhoto size={16} stroke={1.75} aria-hidden />
                )}
                {expense.receipt.fileName}
              </a>
              <button type="button" className="action" onClick={() => picker.current?.click()}>
                Replace
              </button>
              <button
                type="button"
                className="action action-urgent"
                disabled={removeReceipt.isPending}
                onClick={() => removeReceipt.mutate(expense.id, { onSuccess: onClose })}
              >
                Remove
              </button>
            </p>
          ) : (
            <Button onClick={() => picker.current?.click()}>
              <IconPaperclip size={16} stroke={1.75} aria-hidden /> Add a receipt
            </Button>
          )}
          <p className="mt-1.5 text-[12.5px] text-mist">A photo or PDF, kept exactly as it is.</p>
        </div>
        {error ? <Notice tone="urgent">{explain(error)}</Notice> : null}
      </div>
    </Sheet>
  );
}
