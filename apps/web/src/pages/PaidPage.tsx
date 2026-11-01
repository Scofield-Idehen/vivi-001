import { IconCircleCheck } from '@tabler/icons-react';
import { useSearchParams } from 'react-router';

/**
 * Where Stripe sends a guest after its payment page (1 Nov 2026): public, no sign-in. It says
 * only what happened; the booking itself is updated from Stripe, not from this page.
 */
export function PaidPage() {
  const [params] = useSearchParams();
  const notPaid = params.get('not') === '1';
  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-[420px] rounded-2xl bg-paper px-6 py-8 text-center">
        {notPaid ? null : (
          <IconCircleCheck size={40} stroke={1.6} className="mx-auto text-done" aria-hidden />
        )}
        <h1 className="mt-3 font-semibold tracking-[-0.015em] text-[22px] leading-tight text-ink">
          {notPaid ? 'Nothing was paid' : 'Thank you'}
        </h1>
        <p className="mt-2 text-[15px] leading-relaxed text-slate">
          {notPaid
            ? 'You left the payment page before paying. Use the same link again whenever you’re ready, or ask your host for a new one.'
            : 'Your payment went through. Your host can see it now, and Stripe will email you a receipt.'}
        </p>
        <p className="mt-4 text-[13px] text-mist">You can close this page.</p>
      </div>
    </main>
  );
}
