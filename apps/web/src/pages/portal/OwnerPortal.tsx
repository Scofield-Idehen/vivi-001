import { IconArrowLeft, IconLogout, IconPrinter } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { addDays, CHANNEL_LABELS, type Portal, type PortalCalendar, type StatementStatus } from '@v01/shared';
import { useState } from 'react';
import { OperatorMark } from '../../components/BrandMark.tsx';
import { MonthPicker, monthName, shiftMonth } from '../../components/MonthPicker.tsx';
import { Spinner } from '../../components/Spinner.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import { ApiError, usePortal, usePortalCalendar, usePortalStatement } from '../../lib/api.ts';
import { config } from '../../lib/config.ts';
import { demoOriginalRole, setDemoRole } from '../../lib/demo.ts';
import { signOut } from '../../lib/session.tsx';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { StatementDocument } from '../owners/StatementDocument.tsx';
import { moneyText } from '../properties/money.ts';

/**
 * The owner log-in (1 Nov 2026): what an owner sees when they sign in. Their homes only: when each
 * is booked or held this month (no guest names), what this month has earned so far, and their
 * finalised statements, each opening as the document they would be sent, to print or save.
 */

const explain = (e: unknown) => (e instanceof ApiError ? e.message : 'That didn’t load. Try again.');

const STATUS: Record<StatementStatus, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'bg-linen text-slate' },
  final: { label: 'Finalised', tone: 'bg-accent-tint text-accent' },
  paid: { label: 'Paid', tone: 'bg-done/15 text-done-text' },
};

const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const LONG = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long' });
const at = (d: string) => new Date(`${d}T12:00:00`);

export function OwnerPortal() {
  const { entry, orgId } = useCurrentWorkspace();
  const portal = usePortal(orgId);
  const queryClient = useQueryClient();
  const officeRole = config.demo ? demoOriginalRole(entry.organisationId) : null;
  const [statement, setStatement] = useState<string | null>(null);
  const p = portal.data;
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="gutter sticky top-0 z-20 border-b border-hairline bg-paper/95 py-3 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-[1040px] items-center justify-between gap-3">
          <OperatorMark name={p?.organisationName || entry.organisationName} />
          {officeRole ? (
            <button
              type="button"
              className="action shrink-0"
              onClick={() => {
                setDemoRole(entry.organisationId, officeRole);
                void queryClient.invalidateQueries();
              }}
            >
              Back to the office view (demo)
            </button>
          ) : (
            <button type="button" onClick={() => void signOut()} className="action shrink-0">
              <IconLogout size={16} stroke={1.75} aria-hidden />
              Sign out
            </button>
          )}
        </div>
      </header>
      <main className="gutter mx-auto w-full max-w-[1040px] py-8 md:py-10">
        {!p ? (
          portal.isPending ? (
            <Spinner size={16} />
          ) : (
            <Notice tone="urgent">{explain(portal.error)}</Notice>
          )
        ) : statement ? (
          <StatementView month={statement} portal={p} onBack={() => setStatement(null)} />
        ) : (
          <Home p={p} onStatement={setStatement} />
        )}
      </main>
    </div>
  );
}

function Home({ p, onStatement }: { p: Portal; onStatement(month: string): void }) {
  const money = (minor: number) => moneyText(minor, p.currency, 'en-GB');
  const latest = p.statements[0];
  return (
    <>
      <section className="mb-8">
        <p className="text-[13.5px] text-slate">Your homes with {p.organisationName}</p>
        <h1 className="mt-1 text-[28px] leading-[1.15] font-semibold tracking-[-0.02em] text-ink">
          {p.owner.name}
        </h1>
        {p.owner.company ? <p className="text-[14px] text-slate">{p.owner.company}</p> : null}
      </section>

      <dl className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-hairline bg-paper px-5 py-4">
          <dt className="text-[13px] text-slate">Booked in {monthName(p.thisMonth.month)}</dt>
          <dd className="mt-1 text-[26px] font-semibold tracking-[-0.02em] text-ink tnum">
            {p.thisMonth.bookedNights} <span className="text-[15px] font-normal text-slate">nights</span>
          </dd>
          <dd className="text-[12.5px] text-slate">
            Across {p.homes.length} {p.homes.length === 1 ? 'home' : 'homes'}
          </dd>
        </div>
        <div className="rounded-2xl border border-hairline bg-paper px-5 py-4">
          <dt className="text-[13px] text-slate">Earned so far this month</dt>
          <dd className="mt-1 text-[26px] font-semibold tracking-[-0.02em] text-ink tnum">
            {money(p.thisMonth.earnedMinor)}
          </dd>
          <dd className="text-[12.5px] text-slate">Before the fee and expenses</dd>
        </div>
        <div className="rounded-2xl border border-hairline bg-paper px-5 py-4">
          <dt className="text-[13px] text-slate">Latest statement</dt>
          {latest ? (
            <>
              <dd className="mt-1 text-[26px] font-semibold tracking-[-0.02em] text-ink tnum">
                {money(latest.netMinor)}
              </dd>
              <dd className="text-[12.5px] text-slate">
                {monthName(latest.month)} ·{' '}
                {latest.paidOn ? `paid ${LONG.format(at(latest.paidOn))}` : 'to be paid'}
              </dd>
            </>
          ) : (
            <dd className="mt-1 text-[14px] text-slate">
              None yet. Each month’s arrives here once it’s finalised.
            </dd>
          )}
        </div>
      </dl>

      <Calendar p={p} />

      <section aria-labelledby="statements" className="mt-12">
        <h2 id="statements" className="mb-3 text-[18px] font-semibold tracking-[-0.015em] text-ink">
          Statements
        </h2>
        {p.statements.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-hairline px-5 py-8 text-center text-[14px] text-slate">
            No statements yet. When a month is finalised it appears here, with every stay and expense.
          </p>
        ) : (
          <ul className="divide-y divide-hairline overflow-hidden rounded-2xl border border-hairline">
            {p.statements.map((s) => (
              <li key={s.month}>
                <button
                  type="button"
                  onClick={() => onStatement(s.month)}
                  className="grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3.5 text-left transition-colors hover:bg-paper sm:grid-cols-[1fr_repeat(3,auto)]"
                >
                  <span className="text-[14.5px] font-medium text-ink">{monthName(s.month)}</span>
                  <span className="hidden text-[13px] text-slate tnum sm:block">
                    Earned {money(s.earnedMinor)}
                  </span>
                  <span
                    className={`justify-self-end rounded-full px-2 py-0.5 text-[12px] ${STATUS[s.status].tone}`}
                  >
                    {STATUS[s.status].label}
                  </span>
                  <span className="text-right text-[14.5px] font-medium text-ink tnum max-sm:col-span-2">
                    {s.netMinor < 0 ? `You owe ${money(-s.netMinor)}` : money(s.netMinor)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** Each home's month as a strip of nights: booked, held, or free. No guest names. */
function Calendar({ p }: { p: Portal }) {
  const { orgId } = useCurrentWorkspace();
  const [month, setMonth] = useState(p.today.slice(0, 7));
  const first = `${month}-01`;
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1);
  const cal = usePortalCalendar(orgId, first, last);
  const days: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);
  const c = cal.data;
  const state = (home: string, night: string, data: PortalCalendar) => {
    const stay = data.stays.find((s) => s.propertyId === home && s.checkIn <= night && s.checkOut > night);
    if (stay) return { kind: 'booked' as const, stay };
    if (data.blocks.some((b) => b.propertyId === home && b.startsOn <= night && b.endsOn > night))
      return { kind: 'held' as const };
    return { kind: 'free' as const };
  };
  return (
    <section aria-labelledby="calendar">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="calendar" className="text-[18px] font-semibold tracking-[-0.015em] text-ink">
          Bookings
        </h2>
        <MonthPicker value={month} onChange={setMonth} />
      </div>
      <div className="mb-3 flex flex-wrap gap-4 text-[12.5px] text-slate">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-accent" /> Booked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-linen bg-[repeating-linear-gradient(135deg,transparent_0_3px,var(--color-edge)_3px_4px)]" />{' '}
          Held, not for guests
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-hairline bg-canvas" /> Free
        </span>
      </div>
      {!c ? (
        <Spinner size={16} />
      ) : (
        <div className={`flex flex-col gap-4 ${cal.isPlaceholderData ? 'opacity-60' : ''}`}>
          {p.homes.map((h) => {
            const stays = c.stays.filter((s) => s.propertyId === h.id);
            const booked = days.filter((d) => state(h.id, d, c).kind === 'booked').length;
            return (
              <div key={h.id} className="rounded-2xl border border-hairline bg-canvas px-4 py-3.5">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[14.5px] font-medium text-ink">
                    {h.name}
                    {h.area ? <span className="font-normal text-slate"> · {h.area}</span> : null}
                  </p>
                  <p className="text-[12.5px] text-slate tnum">
                    {booked} of {days.length} nights booked
                  </p>
                </div>
                <div
                  className="grid gap-[2px]"
                  style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
                >
                  {days.map((d) => {
                    const s = state(h.id, d, c);
                    return (
                      <div
                        key={d}
                        title={`${SHORT.format(at(d))}: ${s.kind === 'booked' ? `booked (${CHANNEL_LABELS[s.stay.channel]})` : s.kind === 'held' ? 'held' : 'free'}`}
                        className={`h-7 rounded-[3px] ${
                          s.kind === 'booked'
                            ? 'bg-accent'
                            : s.kind === 'held'
                              ? 'bg-linen bg-[repeating-linear-gradient(135deg,transparent_0_3px,var(--color-edge)_3px_4px)]'
                              : 'border border-hairline bg-paper'
                        } ${d === p.today ? 'outline outline-2 outline-offset-1 outline-ink' : ''}`}
                      />
                    );
                  })}
                </div>
                <div
                  className="mt-1 grid text-[10.5px] text-mist tnum"
                  style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
                  aria-hidden
                >
                  {days.map((d, i) => (
                    <span key={d} className="text-center">
                      {i === 0 || (i + 1) % 7 === 0 ? Number(d.slice(8)) : ''}
                    </span>
                  ))}
                </div>
                {stays.length ? (
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-slate">
                    {stays.map((s) => (
                      <li key={s.id}>
                        {SHORT.format(at(s.checkIn))} – {SHORT.format(at(s.checkOut))} ·{' '}
                        {CHANNEL_LABELS[s.channel]}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
          {p.homes.length === 0 ? (
            <p className="text-[14px] text-slate">No homes are recorded as yours yet. Ask the office.</p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function StatementView({ month, portal, onBack }: { month: string; portal: Portal; onBack(): void }) {
  const { orgId } = useCurrentWorkspace();
  const s = usePortalStatement(orgId, month);
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <button type="button" className="action -ml-2.5 inline-flex items-center gap-1" onClick={onBack}>
          <IconArrowLeft size={15} stroke={1.75} aria-hidden /> Your homes
        </button>
        <Button onClick={() => window.print()} disabled={!s.data}>
          <IconPrinter size={16} stroke={1.75} aria-hidden /> Print or save as PDF
        </Button>
      </div>
      {!s.data ? (
        s.isPending ? (
          <Spinner size={16} />
        ) : (
          <Notice tone="urgent">{explain(s.error)}</Notice>
        )
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-hairline print:border-0">
          <StatementDocument m={s.data} from={portal.organisationName} locale="en-GB" />
        </div>
      )}
    </>
  );
}
