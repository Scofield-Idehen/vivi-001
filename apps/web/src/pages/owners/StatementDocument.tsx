import { CHANNEL_LABELS, EXPENSE_CATEGORY_LABELS, type OwnerMonth } from '@v01/shared';
import { monthName } from '../../components/MonthPicker.tsx';
import { moneyText } from '../properties/money.ts';
import { feeText } from './OwnersPage.tsx';

/**
 * The statement as the owner sees it: printed, or saved as a PDF from the print dialog. Plain and
 * black on white: who it's for, the month, the summary, every stay with the nights and money that
 * fall in the month, and the expenses charged. A draft says so across the top.
 */

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const LONG = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const at = (d: string) => new Date(`${d}T12:00:00`);

export function StatementDocument({ m, from, locale }: { m: OwnerMonth; from: string; locale: string }) {
  const money = (minor: number) => moneyText(minor, m.currency, locale);
  const o = m.owner;
  const cell = 'py-1.5 align-top';
  return (
    <article className="print-area mx-auto max-w-[760px] bg-white p-10 text-[12.5px] leading-relaxed text-black">
      {m.statement === null ? (
        <p className="mb-6 rounded border border-black/30 px-3 py-2 text-[12px]">
          Draft: worked out from today’s bookings and expenses. Figures may still change until the statement
          is finalised.
        </p>
      ) : null}
      <header className="mb-8 flex items-start justify-between gap-6">
        <div>
          <p className="text-[11px] tracking-wide text-black/60">Owner statement</p>
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">{monthName(m.month)}</h1>
          <p className="mt-1">
            {o.name}
            {o.company ? `, ${o.company}` : ''}
          </p>
          {o.email ? <p className="text-black/70">{o.email}</p> : null}
        </div>
        <div className="text-right">
          <p className="font-semibold">{from}</p>
          {m.statement ? (
            <p className="text-black/70">
              Finalised {LONG.format(new Date(m.statement.finalisedAt))}
              {m.statement.paidOn ? (
                <>
                  <br />
                  Paid {LONG.format(at(m.statement.paidOn))}
                  {m.statement.paidReference ? `, ref. ${m.statement.paidReference}` : ''}
                </>
              ) : null}
            </p>
          ) : null}
        </div>
      </header>

      <table className="mb-8 w-full border-collapse">
        <tbody>
          {m.grossMinor !== undefined ? (
            <>
              <tr className="border-b border-black/10 text-black/70">
                <td className={cell}>Guests paid for the nights</td>
                <td className={`${cell} text-right tnum`}>{money(m.grossMinor)}</td>
              </tr>
              {m.channelFeesMinor ? (
                <tr className="border-b border-black/10 text-black/70">
                  <td className={cell}>Channel fees (Airbnb, Booking.com, Vrbo)</td>
                  <td className={`${cell} text-right tnum`}>− {money(m.channelFeesMinor)}</td>
                </tr>
              ) : null}
              {m.cleaningMinor ? (
                <tr className="border-b border-black/10 text-black/70">
                  <td className={cell}>Cleaning fees (pay the cleaners)</td>
                  <td className={`${cell} text-right tnum`}>− {money(m.cleaningMinor)}</td>
                </tr>
              ) : null}
              {m.refundsMinor ? (
                <tr className="border-b border-black/10 text-black/70">
                  <td className={cell}>Refunds to guests for their stay</td>
                  <td className={`${cell} text-right tnum`}>− {money(m.refundsMinor)}</td>
                </tr>
              ) : null}
            </>
          ) : null}
          <tr className="border-b border-black/15">
            <td className={cell}>What your {m.homes.length === 1 ? 'home' : 'homes'} brought in</td>
            <td className={`${cell} text-right tnum`}>{money(m.earnedMinor)}</td>
          </tr>
          {m.homes.some((h) => h.deal === 'fixed_rent') ? (
            <tr className="border-b border-black/15">
              <td className={cell}>
                Your part:{' '}
                {m.homes.map((h) => `${h.name} ${shareText(h, o.feeBasisPoints, money)}`).join('; ')}
              </td>
              <td className={`${cell} text-right tnum`}>
                {money(m.ownerShareMinor ?? m.earnedMinor - m.feeMinor)}
              </td>
            </tr>
          ) : (
            <tr className="border-b border-black/15">
              <td className={cell}>
                Management fee
                {m.homes.every((h) => h.deal === 'no_fee')
                  ? ' (none)'
                  : ` (${feeSummary(m, o.feeBasisPoints)})`}
              </td>
              <td className={`${cell} text-right tnum`}>
                {m.feeMinor ? `− ${money(m.feeMinor)}` : money(0)}
              </td>
            </tr>
          )}
          <tr className="border-b border-black/15">
            <td className={cell}>Expenses charged to you</td>
            <td className={`${cell} text-right tnum`}>
              {m.expensesMinor ? `− ${money(m.expensesMinor)}` : money(0)}
            </td>
          </tr>
          {m.claimCreditsMinor ? (
            <tr className="border-b border-black/15">
              <td className={cell}>Claim money paid back for repairs</td>
              <td className={`${cell} text-right tnum`}>{money(m.claimCreditsMinor)}</td>
            </tr>
          ) : null}
          <tr className="text-[14px] font-semibold">
            <td className="pt-2.5">{m.netMinor < 0 ? 'Owed by you' : 'Due to you'}</td>
            <td className="pt-2.5 text-right tnum">{money(Math.abs(m.netMinor))}</td>
          </tr>
        </tbody>
      </table>

      <h2 className="mb-2 text-[14px] font-semibold">Stays</h2>
      {m.bookings.length ? (
        <table className="mb-8 w-full border-collapse">
          <thead>
            <tr className="border-b border-black/30 text-left text-[11px] text-black/60">
              <th className="pb-1 font-normal">Home</th>
              <th className="pb-1 font-normal">Guest</th>
              <th className="pb-1 font-normal">Booked on</th>
              <th className="pb-1 font-normal">Stay</th>
              <th className="pb-1 text-right font-normal">Nights this month</th>
              <th className="pb-1 text-right font-normal">Earned</th>
            </tr>
          </thead>
          <tbody>
            {m.bookings.map((b) => (
              <tr key={b.reservationId} className="border-b border-black/10">
                <td className={cell}>{b.propertyName}</td>
                <td className={cell}>{b.guestName ?? 'Guest'}</td>
                <td className={cell}>{CHANNEL_LABELS[b.channel]}</td>
                <td className={cell}>
                  {DAY.format(at(b.checkIn))} – {DAY.format(at(b.checkOut))}
                </td>
                <td className={`${cell} text-right tnum`}>{b.nights}</td>
                <td className={`${cell} text-right tnum`}>{money(b.earnedMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mb-8 text-black/70">No nights booked this month.</p>
      )}

      <h2 className="mb-2 text-[14px] font-semibold">Expenses charged to you</h2>
      {m.expenses.length ? (
        <table className="mb-8 w-full border-collapse">
          <thead>
            <tr className="border-b border-black/30 text-left text-[11px] text-black/60">
              <th className="pb-1 font-normal">Date</th>
              <th className="pb-1 font-normal">Home</th>
              <th className="pb-1 font-normal">What</th>
              <th className="pb-1 text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {m.expenses.map((e) => (
              <tr key={e.id} className="border-b border-black/10">
                <td className={cell}>{DAY.format(at(e.spentOn))}</td>
                <td className={cell}>{e.propertyName}</td>
                <td className={cell}>
                  {e.description}
                  <span className="text-black/60">
                    {' '}
                    · {EXPENSE_CATEGORY_LABELS[e.category]}
                    {e.vendor ? ` · ${e.vendor}` : ''}
                  </span>
                </td>
                <td className={`${cell} text-right tnum`}>{money(e.amountMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mb-8 text-black/70">None this month.</p>
      )}

      <p className="text-[11px] text-black/60">
        Each stay’s payout is spread evenly over its nights; the nights falling in {monthName(m.month)} count
        here. The cleaning fee guests pay goes to the cleaners. Receipts for the expenses are available on
        request.
      </p>
    </article>
  );
}

function shareText(h: OwnerMonth['homes'][number], ownerFee: number, money: (m: number) => string): string {
  if (h.deal === 'fixed_rent') return `rent ${money(h.rentMinor ?? 0)}`;
  if (h.deal === 'no_fee') return 'no fee';
  return `less ${feeText(h.feeBasisPoints ?? ownerFee)}`;
}

function feeSummary(m: OwnerMonth, ownerFee: number): string {
  const rates = [
    ...new Set(m.homes.filter((h) => h.deal !== 'no_fee').map((h) => h.feeBasisPoints ?? ownerFee)),
  ];
  return rates.length === 1 ? feeText(rates[0] as number) : 'by home';
}
