import { IconCopy, IconExternalLink, IconEye } from '@tabler/icons-react';
import { can, type WorkspaceRole } from '@v01/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Toggle } from '../../components/fields.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import { ApiError, useBookingSite, useUpdateBookingSite } from '../../lib/api.ts';
import { config } from '../../lib/config.ts';

/**
 * The booking website (2 Nov 2026), in place of Guesty's booking engine: switch it on, a service
 * fee if wanted, and the terms guests accept. Which homes are on it is each home's own switch.
 */

const explain = (error: unknown) =>
  error instanceof ApiError ? error.message : 'That didn’t go through. Try again.';

export function BookingSiteSection({ orgId, role }: { orgId: string; role: WorkspaceRole }) {
  const manage = can(role, 'workspace.manage');
  const site = useBookingSite(orgId);
  const update = useUpdateBookingSite(orgId);
  const s = site.data;
  const [fee, setFee] = useState('');
  const [terms, setTerms] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!s) return;
    setFee(s.serviceFeeBp ? String(s.serviceFeeBp / 100) : '');
    setTerms(s.terms ?? '');
  }, [s]);
  if (!s) return site.error ? <Notice tone="urgent">{explain(site.error)}</Notice> : null;
  const url = `${window.location.origin.startsWith('http') ? window.location.origin : 'https://app.v01'}/book/${s.slug}`;
  const feeNumber = fee.trim() === '' ? null : Number(fee);
  const feeValid = feeNumber === null || (Number.isFinite(feeNumber) && feeNumber > 0 && feeNumber <= 20);
  const changed =
    (feeValid && (feeNumber === null ? null : Math.round(feeNumber * 100)) !== s.serviceFeeBp) ||
    (terms.trim() || null) !== s.terms;

  return (
    <section id="booking-site" aria-labelledby="booking-site-heading" className="scroll-mt-6 lg:col-span-2">
      <h2 id="booking-site-heading" className="mb-1 text-[15px] font-medium">
        Booking website
      </h2>
      <p className="mb-3 max-w-[640px] text-[13px] text-slate">
        Guests find your homes, see the price for their dates and pay by card, as on Guesty’s booking site. A
        booking made there is confirmed straight away and closes the nights on every channel. Put homes on it
        from each home’s Settings.
      </p>
      {update.error ? (
        <div className="mb-3">
          <Notice tone="urgent">{explain(update.error)}</Notice>
        </div>
      ) : null}
      <div className="max-w-[640px] rounded-xl border border-hairline bg-white px-4">
        {manage ? (
          <Toggle
            label="Booking website on"
            description={
              s.on
                ? `${s.homesOn} ${s.homesOn === 1 ? 'home is' : 'homes are'} on it.`
                : 'Off: the address shows nothing.'
            }
            checked={s.on}
            onChange={(on) => update.mutate({ on })}
          />
        ) : (
          <p className="py-3 text-[14px] text-ink">{s.on ? `On, with ${s.homesOn} homes` : 'Off'}</p>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-hairline py-3 text-[14px]">
          <span className="min-w-0 flex-1 truncate text-ink">{url}</span>
          <button
            type="button"
            className="action"
            onClick={() => {
              void navigator.clipboard?.writeText(url).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            <IconCopy size={15} stroke={1.75} /> {copied ? 'Copied' : 'Copy link'}
          </button>
          {config.demo ? (
            <Link className="action" to={`/book/${s.slug}${s.on ? '' : `?preview=${orgId}`}`}>
              <IconExternalLink size={15} stroke={1.75} /> {s.on ? 'Open' : 'Preview'}
            </Link>
          ) : (
            <>
              {s.on ? (
                <a className="action" href={url} target="_blank" rel="noreferrer">
                  <IconExternalLink size={15} stroke={1.75} /> Open
                </a>
              ) : null}
              <a className="action" href={`${url}?preview=${orgId}`} target="_blank" rel="noreferrer">
                <IconEye size={15} stroke={1.75} /> Preview with all homes
              </a>
            </>
          )}
        </div>
        {!s.canPay ? (
          <p className="border-t border-hairline py-3 text-[13px] text-slate">
            Card payments aren’t set up, so guests can look but not book.
          </p>
        ) : null}
        {manage ? (
          <div className="flex flex-col gap-3 border-t border-hairline py-4">
            <label className="flex flex-col gap-1 text-[14px] text-ink">
              Service fee (optional)
              <span className="flex items-center gap-2">
                <input
                  inputMode="decimal"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  aria-invalid={!feeValid}
                  className="h-10 w-24 rounded-lg border border-hairline px-3 text-[14.5px] outline-none focus:border-ink aria-[invalid=true]:border-urgent"
                />
                <span className="text-slate">% of the stay, shown to guests as a service fee</span>
              </span>
              {!feeValid ? (
                <span className="text-[13px] text-urgent">
                  Enter a percentage up to 20, or leave it empty.
                </span>
              ) : null}
            </label>
            <label className="flex flex-col gap-1 text-[14px] text-ink">
              Booking terms guests accept
              <textarea
                rows={5}
                maxLength={8000}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder="Payment, cancellation, house rules, damage, and anything else guests agree to when they book."
                className="rounded-lg border border-hairline px-3 py-2 text-[14.5px] outline-none focus:border-ink"
              />
            </label>
            <div>
              <Button
                variant="primary"
                disabled={!changed || !feeValid || update.isPending}
                onClick={() =>
                  update.mutate({
                    serviceFeeBp: feeNumber === null ? null : Math.round(feeNumber * 100),
                    terms: terms.trim() || null,
                  })
                }
              >
                Save
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
