import { IconX } from '@tabler/icons-react';
import {
  formatMoney,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
  parseMajorToMinor,
  type Reservation,
} from '@v01/shared';
import { useState } from 'react';
import { DateField } from '../../components/DateField.tsx';
import { SelectField, TextField } from '../../components/fields.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import { ApiError, useAddCharge, useAddPayment, useRemoveCharge, useRemovePayment } from '../../lib/api.ts';
import { shortDate } from '../../lib/format.ts';
import { ChannelName } from './parts.tsx';

/**
 * The money on a booking, for the record: the channel's total, extra charges the team adds (a
 * late check-out, a pet; a discount as a minus), payments received, and the balance they make.
 * Nothing is charged from here; taking payments comes in Phase 4.
 */

const explain = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That didn’t go through. Try again.';

const METHOD_OPTIONS = PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }));

/** "450", "-20", "1,200.50" into minor units, or an error in words. */
function parseAmount(text: string, currency: string): { minor?: number; error?: string } {
  const cleaned = text.trim().replace(/[^\d.-]/g, '');
  if (!cleaned || cleaned === '-') return { error: 'An amount, such as 45.' };
  const negative = cleaned.startsWith('-');
  try {
    const minor = parseMajorToMinor(cleaned.replace('-', ''), currency);
    if (minor === 0) return { error: 'An amount, such as 45.' };
    return { minor: negative ? -minor : minor };
  } catch {
    return { error: 'An amount, such as 45 or 45.00.' };
  }
}

function AddCharge({
  orgId,
  r,
  currency,
  onDone,
}: {
  orgId: string;
  r: Reservation;
  currency: string;
  onDone(): void;
}) {
  const add = useAddCharge(orgId, r.id);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const parsed = amount ? parseAmount(amount, currency) : {};
  const ready = label.trim().length > 0 && parsed.minor !== undefined && !add.isPending;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-canvas p-3.5">
      <TextField label="What for" value={label} onChange={setLabel} max={80} placeholder="Late check-out" />
      <TextField
        label={`Amount (${currency})`}
        value={amount}
        onChange={setAmount}
        placeholder="45.00"
        error={amount ? parsed.error : undefined}
        hint="A minus makes it a discount."
      />
      {add.error ? <Notice tone="urgent">{explain(add.error)}</Notice> : null}
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          disabled={!ready}
          onClick={() =>
            add.mutate({ label: label.trim(), amountMinor: parsed.minor as number }, { onSuccess: onDone })
          }
        >
          Add charge
        </Button>
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AddPayment({
  orgId,
  r,
  currency,
  onDone,
}: {
  orgId: string;
  r: Reservation;
  currency: string;
  onDone(): void;
}) {
  const add = useAddPayment(orgId, r.id);
  const [amount, setAmount] = useState(
    r.balanceMinor !== null && r.balanceMinor > 0 ? (r.balanceMinor / 100).toFixed(2) : '',
  );
  const [method, setMethod] = useState<PaymentMethod>(r.channel === 'direct' ? 'bank_transfer' : 'channel');
  const [paidOn, setPaidOn] = useState(r.today);
  const [note, setNote] = useState('');
  const parsed = amount ? parseAmount(amount, currency) : {};
  const ready = parsed.minor !== undefined && !add.isPending;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-canvas p-3.5">
      <TextField
        label={`Amount (${currency})`}
        value={amount}
        onChange={setAmount}
        placeholder="450.00"
        error={amount ? parsed.error : undefined}
        hint="A minus records a refund."
      />
      <SelectField
        label="How"
        value={method}
        onChange={(v) => setMethod(v as PaymentMethod)}
        options={METHOD_OPTIONS}
      />
      <DateField label="Received on" value={paidOn} onChange={setPaidOn} today={r.today} max={r.today} />
      <TextField label="Note" value={note} onChange={setNote} max={400} placeholder="Deposit" />
      {add.error ? <Notice tone="urgent">{explain(add.error)}</Notice> : null}
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          disabled={!ready}
          onClick={() =>
            add.mutate(
              {
                amountMinor: parsed.minor as number,
                method,
                paidOn,
                ...(note.trim() ? { note: note.trim() } : {}),
              },
              { onSuccess: onDone },
            )
          }
        >
          Record payment
        </Button>
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function Money({
  orgId,
  r,
  locale,
  timeZone,
  canWrite,
}: {
  orgId: string;
  r: Reservation;
  locale: string;
  timeZone: string;
  canWrite: boolean;
}) {
  const currency = r.currency ?? 'GBP';
  const money = (minor: number) => formatMoney({ amountMinor: minor, currency }, locale);
  const removeCharge = useRemoveCharge(orgId, r.id);
  const removePayment = useRemovePayment(orgId, r.id);
  const [adding, setAdding] = useState<'charge' | 'payment' | null>(null);
  const when = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone,
  }).format(new Date(r.createdAt));
  const balance = r.balanceMinor;
  const settled = balance !== null && balance <= 0;

  return (
    <div className="rounded-2xl bg-paper p-5">
      <p className="text-[13px] text-slate">Booked on</p>
      <p className="mt-1.5 text-[14.5px] text-ink">
        <ChannelName channel={r.channel} reference={r.channelReference} />
      </p>
      <dl className="mt-4 flex flex-col gap-2.5 border-t border-hairline pt-4 text-[13.5px]">
        <div className="flex justify-between gap-4">
          <dt className="text-slate">Booked</dt>
          <dd className="text-ink">{when}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate">Total</dt>
          <dd className="tnum text-ink">{r.totalMinor !== null ? money(r.totalMinor) : 'Not sent'}</dd>
        </div>
        {r.charges.map((c) => (
          <div key={c.id} className="flex justify-between gap-4">
            <dt className="flex min-w-0 items-center gap-1 text-slate">
              <span className="truncate">{c.label}</span>
              {canWrite ? (
                <button
                  type="button"
                  aria-label={`Remove ${c.label}`}
                  onClick={() => removeCharge.mutate(c.id)}
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-mist hover:bg-linen hover:text-ink"
                >
                  <IconX size={13} stroke={2} />
                </button>
              ) : null}
            </dt>
            <dd className="shrink-0 whitespace-nowrap tnum text-ink">
              {c.amountMinor < 0 ? `−${money(-c.amountMinor)}` : money(c.amountMinor)}
            </dd>
          </div>
        ))}
        {r.payments.map((p) => (
          <div key={p.id} className="flex justify-between gap-4">
            <dt className="flex min-w-0 items-center gap-1 text-slate">
              <span className="truncate">
                {p.amountMinor < 0 ? 'Refund' : 'Paid'} {shortDate(`${p.paidOn}T12:00:00`)}
                <span className="text-mist"> · {PAYMENT_METHOD_LABELS[p.method]}</span>
                {p.note ? <span className="text-mist"> · {p.note}</span> : null}
              </span>
              {canWrite ? (
                <button
                  type="button"
                  aria-label="Remove this payment"
                  onClick={() => removePayment.mutate(p.id)}
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-mist hover:bg-linen hover:text-ink"
                >
                  <IconX size={13} stroke={2} />
                </button>
              ) : null}
            </dt>
            <dd className="shrink-0 whitespace-nowrap tnum text-ink">
              {p.amountMinor < 0 ? money(-p.amountMinor) : `−${money(p.amountMinor)}`}
            </dd>
          </div>
        ))}
        {balance !== null ? (
          <div className="flex justify-between gap-4 border-t border-hairline pt-2.5 font-medium">
            <dt className={settled ? 'text-done' : 'text-ink'}>{settled ? 'Paid in full' : 'Balance due'}</dt>
            <dd className="tnum text-ink">
              {settled ? (balance < 0 ? `${money(-balance)} over` : '') : money(balance)}
            </dd>
          </div>
        ) : null}
        {r.payoutMinor !== null ? (
          <div className="flex justify-between gap-4">
            <dt className="text-slate">Payout</dt>
            <dd className="tnum text-ink">{money(r.payoutMinor)}</dd>
          </div>
        ) : null}
      </dl>
      {removeCharge.error || removePayment.error ? (
        <div className="mt-3">
          <Notice tone="urgent">{explain(removeCharge.error ?? removePayment.error)}</Notice>
        </div>
      ) : null}
      {canWrite && r.status !== 'cancelled' ? (
        <div className="mt-3">
          {adding === 'charge' ? (
            <AddCharge orgId={orgId} r={r} currency={currency} onDone={() => setAdding(null)} />
          ) : adding === 'payment' ? (
            <AddPayment orgId={orgId} r={r} currency={currency} onDone={() => setAdding(null)} />
          ) : (
            <div className="-ml-2.5 flex flex-wrap">
              <button type="button" onClick={() => setAdding('charge')} className="action">
                Add a charge
              </button>
              <button type="button" onClick={() => setAdding('payment')} className="action">
                Record a payment
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
