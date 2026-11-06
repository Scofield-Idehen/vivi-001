import { StripeGateway, stripeForm } from '@v01/integrations';

/**
 * pnpm stripe:check — proves the Stripe key works, in test mode only, without touching ViVi OS's
 * data: makes a payment page, then holds a £1 deposit on Stripe's test card, keeps 50p and
 * checks the rest went back; holds another and releases it. Prints statuses only.
 */

const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error('STRIPE_SECRET_KEY is not set.');
const gateway = new StripeGateway({ secretKey: key });
if (gateway.live) throw new Error('This is a live key. The check only runs on a test key.');

async function stripe<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: body ? stripeForm(body).toString() : undefined,
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${json.error?.message}`);
  return json;
}

const results: Record<string, string> = { mode: 'test' };
const account = await stripe<{
  settings?: { dashboard?: { display_name?: string } };
  default_currency?: string;
}>('GET', '/v1/account');
results.account = account.settings?.dashboard?.display_name ? 'named' : 'unnamed';
results.currency = account.default_currency ?? '?';

const page = await gateway.createCheckout({
  kind: 'payment',
  amountMinor: 100,
  currency: 'GBP',
  description: 'ViVi OS check (test)',
  successUrl: 'https://example.com/paid',
  cancelUrl: 'https://example.com/paid?not=1',
  metadata: { v01_check: 'yes' },
  idempotencyKey: `v01-check-${Date.now()}`,
});
results.paymentPage = page.url.startsWith('https://checkout.stripe.com') ? 'made' : 'odd url';
results.paymentPageState = (await gateway.checkout(page.sessionId)).session;
await gateway.expireCheckout(page.sessionId);
results.paymentPageCancelled = (await gateway.checkout(page.sessionId)).session;

type Intent = { id: string; status: string; amount_received: number; amount_capturable: number };
const hold = (amount: number) =>
  stripe<Intent>('POST', '/v1/payment_intents', {
    amount,
    currency: 'gbp',
    capture_method: 'manual',
    payment_method: 'pm_card_visa',
    payment_method_types: ['card'],
    confirm: true,
    description: 'ViVi OS check deposit (test)',
  });
const d1 = await hold(100);
results.depositHeld = `${d1.status} (${d1.amount_capturable}p held)`;
await gateway.capture(d1.id, 50);
const d1after = await stripe<Intent>('GET', `/v1/payment_intents/${d1.id}`);
results.depositKept = `${d1after.status} (${d1after.amount_received}p kept, rest released)`;
const d2 = await hold(100);
await gateway.release(d2.id);
const d2after = await stripe<Intent>('GET', `/v1/payment_intents/${d2.id}`);
results.depositReleased = d2after.status;

console.log(JSON.stringify(results, null, 2));
