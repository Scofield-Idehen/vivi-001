import { IconCircleCheck, IconClock, IconInfoCircle } from '@tabler/icons-react';
import { Link, useParams } from 'react-router';
import { Spinner } from '../../components/Spinner.tsx';
import { useSite, useSiteBooking } from '../../lib/api.ts';
import { longDay, money, SiteFrame } from './parts.tsx';

/**
 * Where Stripe sends the guest back (2 Nov 2026). V-01 saves the booking here and only then
 * charges the card; this page says which way it went: booked (with their stay page), still
 * waiting for payment, the dates gone meanwhile (nothing charged), or the payment page closed.
 */
export function SiteDonePage() {
  const { slug = '', bookingId = '' } = useParams();
  const booking = useSiteBooking(slug, bookingId);
  const site = useSite(slug, {});
  const b = booking.data;
  return (
    <SiteFrame slug={slug} brand={site.data?.brand} testMode={site.data?.testMode}>
      <div className="mx-auto max-w-[560px] pt-12">
        {booking.isPending ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : !b ? (
          <p className="text-center text-[16px] text-slate">
            We couldn’t find this booking. Check the link, or contact us.
          </p>
        ) : (
          <section className="rounded-2xl bg-white p-6 shadow-[0_8px_28px_rgba(20,28,32,0.06)]">
            {b.status === 'booked' ? (
              <>
                <IconCircleCheck size={40} stroke={1.5} className="text-done" />
                <h1 className="mt-3 font-semibold tracking-[-0.02em] text-[26px] text-ink">You’re booked</h1>
                <p className="mt-2 text-[16px] leading-relaxed text-ink">
                  {b.home}, {longDay(b.checkIn)} to {longDay(b.checkOut)}. We’ve taken{' '}
                  {money(b.totalMinor, b.currency)} and Stripe has sent a receipt to {b.email}.
                </p>
                {b.stayPath ? (
                  <>
                    <p className="mt-3 text-[15px] text-slate">
                      Your stay page has the address, check-in times and, from the day you arrive, your door
                      code. Keep the link.
                    </p>
                    <Link
                      to={b.stayPath}
                      className="mt-4 inline-flex h-12 items-center justify-center rounded-xl bg-accent px-5 text-[16px] font-medium text-white"
                    >
                      Open your stay page
                    </Link>
                  </>
                ) : null}
              </>
            ) : b.status === 'open' ? (
              <>
                <IconClock size={40} stroke={1.5} className="text-slate" />
                <h1 className="mt-3 font-semibold tracking-[-0.02em] text-[26px] text-ink">
                  Waiting for your payment
                </h1>
                <p className="mt-2 text-[16px] text-ink">
                  If you’ve just paid, this page updates in a few seconds. If you left the payment page, you
                  can go back to it.
                </p>
                {b.url ? (
                  <a
                    href={b.url}
                    className="mt-4 inline-flex h-12 items-center justify-center rounded-xl bg-accent px-5 text-[16px] font-medium text-white"
                  >
                    Back to payment
                  </a>
                ) : null}
              </>
            ) : (
              <>
                <IconInfoCircle size={40} stroke={1.5} className="text-pending" />
                <h1 className="mt-3 font-semibold tracking-[-0.02em] text-[26px] text-ink">
                  {b.status === 'refused' ? 'Those dates were just taken' : 'The payment page closed'}
                </h1>
                <p className="mt-2 text-[16px] text-ink">
                  {b.status === 'refused'
                    ? 'Someone else booked these nights while you were paying. Your card has not been charged; any hold on it is released.'
                    : 'Nothing was charged. You can choose your dates again.'}
                </p>
                <Link
                  to={`/book/${slug}`}
                  className="mt-4 inline-flex h-12 items-center justify-center rounded-xl bg-accent px-5 text-[16px] font-medium text-white"
                >
                  See homes
                </Link>
              </>
            )}
          </section>
        )}
      </div>
    </SiteFrame>
  );
}
