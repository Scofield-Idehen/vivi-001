import { IconAlertTriangle } from '@tabler/icons-react';
import {
  CLAIM_STATUS_LABELS,
  type ClaimStatus,
  type ClaimSummary,
  type ClaimView,
  can,
  claimDeadline,
  todayIn,
} from '@v01/shared';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { TextField } from '../../components/fields.tsx';
import { Sheet } from '../../components/Sheet.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import { Button, Notice, PageHeader } from '../../components/ui.tsx';
import { ApiError, useClaims, useReservations, useStartClaim, useWorkspace } from '../../lib/api.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { ChannelMark } from '../calendar/marks.tsx';
import { moneyText } from '../properties/money.ts';

/**
 * Claims (built 30 Oct 2026): damage a guest left, one claim per booking. Active ones are ordered
 * by deadline so the closest is first; bookings where the team reported damage and there is no
 * claim yet sit above, one press from starting one.
 */

const at = (d: string) => new Date(`${d}T12:00:00`);
const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const LONG = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const explain = (e: unknown) => (e instanceof ApiError ? e.message : 'That didn’t go through. Try again.');

export const daysLeft = (deadline: string, today: string) =>
  Math.round((Date.parse(deadline) - Date.parse(today)) / 86_400_000);

/** "6 days left", in the colour of how close it is. */
export function Countdown({
  deadline,
  today,
  size = 'sm',
}: {
  deadline: string;
  today: string;
  size?: 'sm' | 'lg';
}) {
  const left = daysLeft(deadline, today);
  const tone =
    left < 0 || left <= 2
      ? 'bg-urgent/10 text-urgent'
      : left <= 5
        ? 'bg-pending/15 text-pending-text'
        : 'bg-linen text-ink';
  const words =
    left < 0
      ? `${-left} ${-left === 1 ? 'day' : 'days'} late`
      : left === 0
        ? 'Due today'
        : `${left} ${left === 1 ? 'day' : 'days'} left`;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-semibold tnum ${tone} ${size === 'lg' ? 'px-3 py-1 text-[14px]' : 'px-2.5 py-0.5 text-[12.5px]'}`}
    >
      {left <= 2 ? <IconAlertTriangle size={size === 'lg' ? 16 : 14} stroke={2} aria-hidden /> : null}
      {words}
    </span>
  );
}

const STATUS_TONE: Record<ClaimStatus, string> = {
  open: 'text-pending-text',
  filed: 'text-accent',
  paid: 'text-done-text',
  closed: 'text-slate',
};

function Row({ c, today, locale }: { c: ClaimSummary; today: string; locale: string }) {
  const m = (minor: number) => moneyText(minor, c.currency, locale);
  return (
    <li>
      <Link
        to={`/claims/${c.id}`}
        className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 transition-colors hover:bg-paper sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_auto]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <ChannelMark channel={c.channel} size={22} />
          <span className="min-w-0">
            <span className="block truncate text-[14.5px] font-medium text-ink">
              {c.guestName ?? 'Guest'}
            </span>
            <span className="block truncate text-[13px] text-slate">
              {c.propertyName} · left {SHORT.format(at(c.checkOut))}
            </span>
          </span>
        </span>
        <span className={`text-[13px] font-medium max-sm:hidden ${STATUS_TONE[c.status]}`}>
          {CLAIM_STATUS_LABELS[c.status]}
        </span>
        <span className="text-right text-[14px] text-ink tnum max-sm:col-start-2 max-sm:row-start-1">
          {m(c.claimedMinor)}
          {c.receivedMinor !== null ? (
            <span className="block text-[12.5px] text-done-text">{m(c.receivedMinor)} received</span>
          ) : null}
        </span>
        <span className="text-right max-sm:col-span-2 max-sm:text-left">
          {c.status === 'open' ? (
            <Countdown deadline={c.deadline} today={today} />
          ) : (
            <span className="text-[12.5px] text-slate">
              {c.status === 'filed'
                ? `Deadline ${SHORT.format(at(c.deadline))}`
                : CLAIM_STATUS_LABELS[c.status]}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

export function ClaimsPage() {
  const { orgId, entry } = useCurrentWorkspace();
  const workspace = useWorkspace(orgId);
  const locale = workspace.data?.settings.locale ?? 'en-GB';
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') === 'done' ? 'done' : 'active') as ClaimView;
  const list = useClaims(orgId, view);
  const start = useStartClaim(orgId);
  const navigate = useNavigate();
  const [picking, setPicking] = useState(false);
  const write = can(entry.role, 'claims.write');
  const d = list.data;
  const today = d?.today ?? todayIn(workspace.data?.settings.timeZone ?? 'Europe/London');

  return (
    <>
      <PageHeader
        title="Claims"
        description="Damage a guest left, one claim per booking: what it costs, the photos from before and after the stay, and the receipts, with the deadline in front of you."
        action={
          write ? (
            <Button variant="primary" onClick={() => setPicking(true)}>
              Start a claim
            </Button>
          ) : undefined
        }
      />
      {picking ? <StartClaimSheet onClose={() => setPicking(false)} /> : null}

      {d?.suggestions.length && write ? (
        <section
          aria-labelledby="reported"
          className="mb-8 rounded-2xl border border-pending/40 bg-pending/5 p-4 sm:p-5"
        >
          <h2 id="reported" className="text-[15px] font-semibold text-ink">
            Damage reported, no claim yet
          </h2>
          <p className="mt-0.5 mb-3 text-[13px] text-slate">The team found something after these stays.</p>
          <ul className="divide-y divide-hairline overflow-hidden rounded-xl border border-hairline bg-canvas">
            {d.suggestions.map((s) => (
              <li
                key={s.reservationId}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <ChannelMark channel={s.channel} size={22} />
                  <span className="min-w-0">
                    <span className="block truncate text-[14.5px] text-ink">{s.guestName ?? 'Guest'}</span>
                    <span className="block truncate text-[13px] text-slate">
                      {s.propertyName} · left {SHORT.format(at(s.checkOut))} · {s.reports}{' '}
                      {s.reports === 1 ? 'report' : 'reports'}
                    </span>
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <Countdown deadline={s.deadline} today={today} />
                  <Button
                    disabled={start.isPending}
                    onClick={() =>
                      start.mutate(s.reservationId, { onSuccess: (c) => navigate(`/claims/${c.id}`) })
                    }
                  >
                    Start claim
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          {start.error ? (
            <div className="mt-3">
              <Notice tone="urgent">{explain(start.error)}</Notice>
            </div>
          ) : null}
        </section>
      ) : null}

      <div role="tablist" aria-label="Which claims" className="mb-4 flex gap-2">
        {(['active', 'done'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setParams(v === 'active' ? {} : { view: v }, { replace: true })}
            className={`h-9 rounded-full border px-4 text-[13.5px] transition-colors ${view === v ? 'border-ink bg-ink text-canvas' : 'border-hairline text-ink hover:border-edge'}`}
          >
            {v === 'active' ? 'Active' : 'Done'} ({d ? d.counts[v] : '…'})
          </button>
        ))}
      </div>

      {list.isPending ? (
        <Spinner size={16} />
      ) : list.error && !d ? (
        <Notice tone="urgent">{explain(list.error)}</Notice>
      ) : d && d.claims.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-hairline px-5 py-10 text-center text-[14px] text-slate">
          {view === 'active'
            ? 'No claims being worked on. When a guest leaves damage, start one from their booking or here.'
            : 'No paid or closed claims yet.'}
        </p>
      ) : d ? (
        <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline bg-canvas">
          {d.claims.map((c) => (
            <Row key={c.id} c={c} today={today} locale={locale} />
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** Pick a stay that ended in the last weeks to start a claim on. Opening one already claimed goes to its claim. */
export function StartClaimSheet({ onClose }: { onClose(): void }) {
  const { orgId } = useCurrentWorkspace();
  const [q, setQ] = useState('');
  const past = useReservations(orgId, 'past', q);
  const start = useStartClaim(orgId);
  const navigate = useNavigate();
  const workspace = useWorkspace(orgId);
  const today = todayIn(workspace.data?.settings.timeZone ?? 'Europe/London');
  const rows = (past.data?.reservations ?? []).filter((r) => r.status === 'confirmed').slice(0, 30);
  return (
    <Sheet title="Start a claim" subtitle="Which stay was it?" onClose={onClose} busy={start.isPending}>
      <div className="flex flex-col gap-4">
        <TextField
          label="Search"
          value={q}
          onChange={setQ}
          placeholder="Guest, home or booking code"
          autoComplete="off"
        />
        {start.error ? <Notice tone="urgent">{explain(start.error)}</Notice> : null}
        {past.isPending ? null : rows.length === 0 ? (
          <p className="text-[14px] text-slate">No stay matches.</p>
        ) : (
          <ul className="divide-y divide-hairline border-y border-hairline">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={start.isPending}
                  onClick={() =>
                    start.mutate(r.id, {
                      onSuccess: (c) => {
                        onClose();
                        navigate(`/claims/${c.id}`);
                      },
                    })
                  }
                  className="flex w-full items-center justify-between gap-4 px-1 py-3 text-left hover:bg-paper"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <ChannelMark channel={r.channel} size={20} />
                    <span className="min-w-0">
                      <span className="block truncate text-[14.5px] text-ink">{r.guestName ?? 'Guest'}</span>
                      <span className="block truncate text-[13px] text-slate">
                        {r.propertyName} · {SHORT.format(at(r.checkIn))} – {LONG.format(at(r.checkOut))}
                      </span>
                    </span>
                  </span>
                  <Countdown deadline={claimDeadline(r.channel, r.checkOut, null)} today={today} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}
