import { type CardRequest, formatMoney, type Reservation } from '@v01/shared';
import { useState } from 'react';
import { useConfirm } from '../../components/Confirm.tsx';
import { TextField } from '../../components/fields.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import { ApiError, useCardAction, useCardRequests } from '../../lib/api.ts';
import { config } from '../../lib/config.ts';
import { parseAmount } from './Money.tsx';

/**
 * Card payments and deposits on a booking (1 Nov 2026). The team makes a Stripe link and sends it
 * to the guest (copied, or on WhatsApp); the guest pays, or lets a damage deposit be held, on
 * Stripe's own page. A payment lands on the booking by itself. A held deposit is kept in part or
 * full (a charge and a payment of the same amount, so the balance doesn't move) or released.
 */

const explain = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That didn’t go through. Try again.';

function NewRequest({
  orgId,
  r,
  kind,
  currency,
  onDone,
}: {
  orgId: string;
  r: Reservation;
  kind: 'payment' | 'deposit';
  currency: string;
  onDone(): void;
}) {
  const make = useCardAction<number>(
    orgId,
    r.id,
    () => `/v1/reservations/${r.id}/card-requests`,
    (amountMinor) => ({ kind, amountMinor }),
  );
  const [amount, setAmount] = useState(
    kind === 'payment' && r.balanceMinor !== null && r.balanceMinor > 0
      ? (r.balanceMinor / 100).toFixed(2)
      : '',
  );
  const parsed = amount ? parseAmount(amount, currency) : {};
  const ready = parsed.minor !== undefined && parsed.minor > 0 && !make.isPending;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-hairline bg-canvas p-3.5">
      <p className="text-[13.5px] text-slate">
        {kind === 'payment'
          ? 'A Stripe link for the guest to pay by card. It lasts 24 hours.'
          : 'The guest’s card is held for this amount, not charged. A hold lasts about 7 days, so ask close to arrival.'}
      </p>
      <TextField
        label={`Amount (${currency})`}
        value={amount}
        onChange={setAmount}
        placeholder={kind === 'payment' ? '450.00' : '200.00'}
        error={
          amount ? parsed.error : parsed.minor !== undefined && parsed.minor < 0 ? 'More than 0.' : undefined
        }
      />
      {make.error ? <Notice tone="urgent">{explain(make.error)}</Notice> : null}
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          disabled={!ready}
          onClick={() => make.mutate(parsed.minor as number, { onSuccess: onDone })}
        >
          {kind === 'payment' ? 'Make payment link' : 'Make deposit link'}
        </Button>
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Keep({
  orgId,
  r,
  req,
  currency,
  onDone,
}: {
  orgId: string;
  r: Reservation;
  req: CardRequest;
  currency: string;
  onDone(): void;
}) {
  const keep = useCardAction<{ amountMinor: number; reason: string }>(
    orgId,
    r.id,
    () => `/v1/card-requests/${req.id}/keep`,
    (b) => b,
  );
  const [amount, setAmount] = useState((req.amountMinor / 100).toFixed(2));
  const [reason, setReason] = useState('');
  const parsed = amount ? parseAmount(amount, currency) : {};
  const over = parsed.minor !== undefined && parsed.minor > req.amountMinor;
  const ready = parsed.minor !== undefined && parsed.minor > 0 && !over && reason.trim() && !keep.isPending;
  const money = (m: number) => formatMoney({ amountMinor: m, currency }, 'en-GB');
  return (
    <div className="mt-2 flex flex-col gap-3 rounded-xl border border-hairline bg-canvas p-3.5">
      <TextField
        label={`Keep (${currency})`}
        value={amount}
        onChange={setAmount}
        error={over ? `At most ${money(req.amountMinor)}.` : amount ? parsed.error : undefined}
        hint="The rest goes back to the guest’s card."
      />
      <TextField label="What for" value={reason} onChange={setReason} max={80} placeholder="Broken lamp" />
      {keep.error ? <Notice tone="urgent">{explain(keep.error)}</Notice> : null}
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          disabled={!ready}
          onClick={() =>
            keep.mutate({ amountMinor: parsed.minor as number, reason: reason.trim() }, { onSuccess: onDone })
          }
        >
          Charge the card
        </Button>
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function statusLine(req: CardRequest, money: (m: number) => string, when: (iso: string) => string): string {
  const what = req.kind === 'payment' ? 'Payment link' : 'Deposit';
  switch (req.status) {
    case 'open':
      return `${what}, waiting for the guest${req.expiresAt ? ` · link ends ${when(req.expiresAt)}` : ''}`;
    case 'paid':
      return 'Paid by card';
    case 'held':
      return 'Deposit held on the card';
    case 'kept':
      return req.keptMinor !== null && req.keptMinor < req.amountMinor
        ? `Deposit: kept ${money(req.keptMinor)}${req.keptReason ? ` (${req.keptReason})` : ''}, rest released`
        : `Deposit kept${req.keptReason ? ` (${req.keptReason})` : ''}`;
    case 'released':
      return 'Deposit released';
    case 'expired':
      return `${what} not used`;
  }
}

export function Cards({
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
  const money = (m: number) => formatMoney({ amountMinor: m, currency }, locale);
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    }).format(new Date(iso));
  const cards = useCardRequests(orgId, r.id);
  const confirm = useConfirm();
  const [making, setMaking] = useState<'payment' | 'deposit' | null>(null);
  const [keeping, setKeeping] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const cancel = useCardAction<string>(orgId, r.id, (id) => `/v1/card-requests/${id}/cancel`);
  const release = useCardAction<string>(orgId, r.id, (id) => `/v1/card-requests/${id}/release`);
  const demoPay = useCardAction<string>(orgId, r.id, (id) => `/v1/card-requests/${id}/demo-pay`);
  const list = cards.data;
  if (!list) {
    // Say why the card section isn't there, rather than leaving a gap.
    return cards.error ? (
      <div className="mt-4 border-t border-hairline pt-3">
        <p className="text-[13px] text-slate">Card</p>
        <div className="mt-2">
          <Notice tone="urgent">{explain(cards.error)}</Notice>
        </div>
      </div>
    ) : null;
  }
  const requests = list.requests;
  if (!list.enabled && requests.length === 0) {
    return canWrite ? (
      <p className="mt-4 border-t border-hairline pt-3 text-[13px] text-mist">
        Card payments switch on once Stripe is connected.
      </p>
    ) : null;
  }
  const phone = r.guestPhone?.replace(/[^\d]/g, '');
  const error = cancel.error ?? release.error ?? demoPay.error;

  return (
    <div className="mt-4 border-t border-hairline pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] text-slate">Card</p>
        {list.testMode ? <p className="text-[12px] text-mist">Stripe test mode, no real money</p> : null}
      </div>
      {requests.length ? (
        <ul className="mt-2 flex flex-col gap-3">
          {requests.map((req) => {
            const live = req.status === 'open' || req.status === 'held';
            return (
              <li key={req.id} className={live ? '' : 'opacity-70'}>
                <div className="flex justify-between gap-4 text-[13.5px]">
                  <span className="min-w-0 text-ink">{statusLine(req, money, when)}</span>
                  <span className="shrink-0 tnum text-ink">{money(req.amountMinor)}</span>
                </div>
                {canWrite && req.status === 'open' && req.url ? (
                  <div className="-ml-2.5 mt-1 flex flex-wrap">
                    <button
                      type="button"
                      className="action"
                      onClick={() => {
                        void navigator.clipboard?.writeText(req.url as string).then(() => setCopied(req.id));
                      }}
                    >
                      {copied === req.id ? 'Copied' : 'Copy link'}
                    </button>
                    {phone ? (
                      <a
                        className="action"
                        target="_blank"
                        rel="noreferrer"
                        href={`https://wa.me/${phone}?text=${encodeURIComponent(
                          req.kind === 'payment'
                            ? `Hello ${r.guestName ?? ''}, here is the link to pay for your stay at ${r.propertyName}: ${req.url}`
                            : `Hello ${r.guestName ?? ''}, here is the link for the damage deposit for your stay at ${r.propertyName}. It is held on your card, not charged: ${req.url}`,
                        )}`}
                      >
                        Send on WhatsApp
                      </a>
                    ) : null}
                    {config.demo ? (
                      <button type="button" className="action" onClick={() => demoPay.mutate(req.id)}>
                        Guest pays (demo)
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="action"
                      onClick={async () => {
                        if (
                          await confirm({
                            title: 'Cancel this link?',
                            body: 'The guest won’t be able to pay with it any more.',
                            action: 'Cancel link',
                            cancel: 'Keep it',
                            tone: 'urgent',
                          })
                        )
                          cancel.mutate(req.id);
                      }}
                    >
                      Cancel link
                    </button>
                  </div>
                ) : null}
                {canWrite && req.status === 'held' ? (
                  keeping === req.id ? (
                    <Keep orgId={orgId} r={r} req={req} currency={currency} onDone={() => setKeeping(null)} />
                  ) : (
                    <div className="-ml-2.5 mt-1 flex flex-wrap">
                      <button type="button" className="action" onClick={() => setKeeping(req.id)}>
                        Keep some or all
                      </button>
                      <button
                        type="button"
                        className="action"
                        onClick={async () => {
                          if (
                            await confirm({
                              title: `Release ${money(req.amountMinor)}?`,
                              body: 'The hold comes off the guest’s card. It can’t be taken again after this.',
                              action: 'Release deposit',
                              cancel: 'Keep holding',
                            })
                          )
                            release.mutate(req.id);
                        }}
                      >
                        Release
                      </button>
                    </div>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {error ? (
        <div className="mt-3">
          <Notice tone="urgent">{explain(error)}</Notice>
        </div>
      ) : null}
      {canWrite && list.enabled && r.status !== 'cancelled' ? (
        <div className="mt-3">
          {making ? (
            <NewRequest
              orgId={orgId}
              r={r}
              kind={making}
              currency={currency}
              onDone={() => setMaking(null)}
            />
          ) : (
            <div className="-ml-2.5 flex flex-wrap">
              <button type="button" className="action" onClick={() => setMaking('payment')}>
                Ask for a card payment
              </button>
              <button type="button" className="action" onClick={() => setMaking('deposit')}>
                Hold a deposit
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
