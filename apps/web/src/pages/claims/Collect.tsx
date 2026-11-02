import { IconCopy, IconExternalLink } from '@tabler/icons-react';
import { type Claim, type ClaimPlace, parseMajorToMinor } from '@v01/shared';
import { useState } from 'react';
import { useConfirm } from '../../components/Confirm.tsx';
import { MoneyField } from '../../components/fields.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import { ApiError, useClaimCollect } from '../../lib/api.ts';
import { config } from '../../lib/config.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { currencySymbol, minorToInput, moneyText } from '../properties/money.ts';

/**
 * Getting paid for a claim (2 Nov 2026). Filed with a channel: their claim page, with the booking
 * code to paste and the evidence to upload; no channel lets software file for you. Filed with the
 * guest: keep some of a deposit still held on their card, or send them a payment link; either way
 * the claim is marked paid with what comes in.
 */

const explain = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That didn’t go through. Try again.';

/** Where each channel takes damage claims. None of them takes a claim from software. */
const CHANNEL_CLAIMS: Partial<Record<ClaimPlace, { name: string; url: string; how: string }>> = {
  airbnb: {
    name: 'Airbnb’s Resolution Centre',
    url: 'https://www.airbnb.co.uk/resolutions',
    how: 'Start a request for this reservation, ask for the amount, and upload the photos and receipts from the evidence download.',
  },
  booking_com: {
    name: 'the Booking.com extranet',
    url: 'https://admin.booking.com/',
    how: 'Open this reservation and report the damage, with the photos and receipts from the evidence download. Booking.com asks the guest to pay, up to the limit in your damage programme.',
  },
  vrbo: {
    name: 'Vrbo',
    url: 'https://help.vrbo.com/articles/How-do-I-file-a-damage-deposit-claim',
    how: 'Follow Vrbo’s damage claim steps for this reservation, with the evidence download.',
  },
  expedia: {
    name: 'Expedia Partner Central',
    url: 'https://apps.expediapartnercentral.com/',
    how: 'Open this reservation and raise the damage, with the evidence download.',
  },
};

export function Collect({ claim, write, locale }: { claim: Claim; write: boolean; locale: string }) {
  const channel = CHANNEL_CLAIMS[claim.place];
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied(null), 2000);
    });
  };

  if (channel) {
    return (
      <div className="flex flex-col gap-3 text-[14px]">
        <p className="text-ink">
          File it on {channel.name}. {channel.how}
        </p>
        <div className="-ml-2.5 flex flex-wrap">
          <a className="action" href={channel.url} target="_blank" rel="noreferrer">
            <IconExternalLink size={15} stroke={1.75} /> Open {channel.name.replace(/^the /, '')}
          </a>
          {claim.channelReference ? (
            <button
              type="button"
              className="action"
              onClick={() => copy('ref', claim.channelReference as string)}
            >
              <IconCopy size={15} stroke={1.75} />
              {copied === 'ref' ? 'Copied' : `Copy booking code ${claim.channelReference}`}
            </button>
          ) : null}
        </div>
        <p className="text-[12.5px] text-slate">
          Then mark it Filed here with their case number, and Paid when the money arrives. Filing with the
          guest instead? Change “Filed with” to the guest.
        </p>
      </div>
    );
  }
  if (claim.place !== 'guest') {
    return (
      <p className="text-[14px] text-slate">Record what the insurer pays under Received when it arrives.</p>
    );
  }
  return <GuestCollect claim={claim} write={write} locale={locale} copied={copied} copy={copy} />;
}

function GuestCollect({
  claim,
  write,
  locale,
  copied,
  copy,
}: {
  claim: Claim;
  write: boolean;
  locale: string;
  copied: string | null;
  copy(key: string, text: string): void;
}) {
  const c = claim.collect;
  const confirm = useConfirm();
  const { orgId } = useCurrentWorkspace();
  const { keep, link } = useClaimCollect(orgId, claim.id);
  const owed = Math.max(0, claim.claimedMinor - (claim.receivedMinor ?? 0));
  const money = (m: number) => moneyText(m, claim.currency, locale);
  const [keepText, setKeepText] = useState(
    minorToInput(
      c.deposit ? Math.min(owed || c.deposit.amountMinor, c.deposit.amountMinor) : null,
      claim.currency,
    ),
  );
  const [askText, setAskText] = useState(minorToInput(owed || null, claim.currency));
  const parse = (t: string): number | null => {
    try {
      const v = parseMajorToMinor(t.replace(/[^\d.]/g, ''), claim.currency);
      return v > 0 ? v : null;
    } catch {
      return null;
    }
  };
  const keepMinor = parse(keepText);
  const askMinor = parse(askText);
  const phone = c.guestPhone?.replace(/[^\d]/g, '');
  const error = keep.error ?? link.error;

  if (!c.enabled)
    return (
      <p className="text-[14px] text-slate">
        Card payments aren’t set up, so ask the guest to pay you directly and record it under Received.
      </p>
    );

  return (
    <div className="flex flex-col gap-5 text-[14px]">
      <p className="text-slate">
        {owed
          ? `${money(owed)} still to collect of ${money(claim.claimedMinor)}.`
          : claim.claimedMinor
            ? 'All of it is collected.'
            : 'List what was damaged and its cost first; that’s what you ask for.'}
        {c.testMode ? ' Stripe test mode: no real money.' : ''}
      </p>

      {c.deposit ? (
        <div className="flex flex-col gap-2">
          <p className="font-medium text-ink">
            {money(c.deposit.amountMinor)} deposit held on the guest’s card
          </p>
          {write ? (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <MoneyField
                  label="Keep"
                  value={keepText}
                  onChange={setKeepText}
                  symbol={currencySymbol(claim.currency, locale)}
                  error={
                    keepMinor && keepMinor > c.deposit.amountMinor ? 'More than the deposit held.' : undefined
                  }
                />
              </div>
              <Button
                variant="primary"
                disabled={!keepMinor || keepMinor > c.deposit.amountMinor || keep.isPending}
                onClick={async () => {
                  if (!keepMinor || !c.deposit) return;
                  const rest = c.deposit.amountMinor - keepMinor;
                  if (
                    await confirm({
                      title: `Keep ${money(keepMinor)} from the deposit?`,
                      body: `It’s charged to the guest’s card now${rest ? ` and the other ${money(rest)} goes back to them` : ''}. The claim is marked paid with it. This can’t be undone.`,
                      action: 'Keep it',
                    })
                  )
                    keep.mutate(keepMinor);
                }}
              >
                Keep
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {write && owed > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="font-medium text-ink">
            {c.deposit ? 'Or ask the guest to pay' : 'Ask the guest to pay'}
          </p>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <MoneyField
                label="Amount"
                value={askText}
                onChange={setAskText}
                symbol={currencySymbol(claim.currency, locale)}
              />
            </div>
            <Button disabled={!askMinor || link.isPending} onClick={() => askMinor && link.mutate(askMinor)}>
              Make payment link
            </Button>
          </div>
        </div>
      ) : null}

      {c.links.length ? (
        <ul className="flex flex-col gap-3 border-t border-hairline pt-4">
          {c.links.map((l) => (
            <li key={l.id}>
              <div className="flex justify-between gap-3">
                <span className="text-ink">
                  {l.status === 'open'
                    ? 'Payment link, not paid yet'
                    : l.status === 'paid'
                      ? 'Paid by card'
                      : 'Link closed, not paid'}
                </span>
                <span className="tnum text-ink">{money(l.amountMinor)}</span>
              </div>
              {l.status === 'open' && l.url ? (
                <div className="-ml-2.5 mt-1 flex flex-wrap">
                  <button type="button" className="action" onClick={() => copy(l.id, l.url as string)}>
                    {copied === l.id ? 'Copied' : 'Copy link'}
                  </button>
                  {phone ? (
                    <a
                      className="action"
                      target="_blank"
                      rel="noreferrer"
                      href={`https://wa.me/${phone}?text=${encodeURIComponent(
                        `Hello ${claim.guestName ?? ''}, here is the link to pay for the damage during your stay at ${claim.propertyName}: ${l.url}`,
                      )}`}
                    >
                      Send on WhatsApp
                    </a>
                  ) : null}
                  {config.demo ? (
                    <span className="px-2.5 py-1.5 text-[12.5px] text-mist">
                      In the demo, the guest pays at once.
                    </span>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <Notice tone="urgent">{explain(error)}</Notice> : null}
    </div>
  );
}
