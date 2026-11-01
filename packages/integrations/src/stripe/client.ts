import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Card payments through Stripe Checkout (1 Nov 2026). The team asks a guest to pay, or to let a
 * damage deposit be held on their card; Stripe's own page takes the card, so no card number ever
 * reaches V-01. Two kinds:
 *   payment  charged at once; it lands on the booking as a card payment.
 *   deposit  authorised but not charged (a hold, which a card keeps for about 7 days). The team
 *            then keeps some or all of it, or releases it.
 *
 * Behind an interface so tests and the demo use the stand-in and the real key swaps in.
 */

export type CardKind = 'payment' | 'deposit';

export interface CheckoutInput {
  kind: CardKind;
  amountMinor: number;
  currency: string;
  /** What the guest sees on Stripe's page: "Stay at Lodge, 3–6 Dec". */
  description: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string | null;
  /** Ours, echoed back on the webhook: which operator and which request. */
  metadata: Record<string, string>;
  /** A key so a retried request doesn't make two sessions. */
  idempotencyKey: string;
}

export interface CheckoutCreated {
  sessionId: string;
  url: string;
  expiresAt: Date;
}

/** Where a request stands at Stripe, read fresh. */
export interface CheckoutState {
  /** open: not paid yet; complete: the guest finished; expired: the link ran out or was cancelled. */
  session: 'open' | 'complete' | 'expired';
  paymentIntentId: string | null;
  /** The payment intent's own status: succeeded, requires_capture, canceled, processing… */
  intent: string | null;
  /** Charged so far, and still held (for a deposit). */
  receivedMinor: number;
  capturableMinor: number;
}

export interface CardGateway {
  /** True for a live key: real money. The API refuses a live key unless told otherwise. */
  readonly live: boolean;
  createCheckout(input: CheckoutInput): Promise<CheckoutCreated>;
  checkout(sessionId: string): Promise<CheckoutState>;
  /** Ends an unpaid link. */
  expireCheckout(sessionId: string): Promise<void>;
  /** Keeps some or all of a held deposit; the rest goes back to the card. */
  capture(paymentIntentId: string, amountMinor: number): Promise<void>;
  /** Lets a held deposit go. */
  release(paymentIntentId: string): Promise<void>;
}

export class CardError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    readonly code = 'card_provider',
  ) {
    super(message);
    this.name = 'CardError';
  }
}

export const STRIPE_API_URL = 'https://api.stripe.com';

/** Stripe's form encoding: nested keys as a[b][c]. */
export function stripeForm(value: Record<string, unknown>, prefix = '', out = new URLSearchParams()) {
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined || v === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === 'object' && item !== null)
          stripeForm(item as Record<string, unknown>, `${name}[${i}]`, out);
        else out.append(`${name}[${i}]`, String(item));
      });
    } else if (typeof v === 'object') {
      stripeForm(v as Record<string, unknown>, name, out);
    } else {
      out.append(name, String(v));
    }
  }
  return out;
}

interface StripeSession {
  id: string;
  url: string | null;
  status: 'open' | 'complete' | 'expired';
  expires_at: number;
  payment_intent:
    | string
    | null
    | { id: string; status: string; amount_received: number; amount_capturable: number };
}

export class StripeGateway implements CardGateway {
  readonly live: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(
    private readonly config: {
      secretKey: string;
      /** A connected account (Stripe Connect), so the money goes to the operator's own Stripe. */
      account?: string;
      baseUrl?: string;
      fetch?: typeof fetch;
    },
  ) {
    this.live = /^(sk|rk)_live_/.test(config.secretKey);
    this.fetchImpl = config.fetch ?? fetch;
    this.baseUrl = config.baseUrl ?? STRIPE_API_URL;
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.config.secretKey}`,
      'stripe-version': '2024-06-20',
    };
    if (this.config.account) headers['stripe-account'] = this.config.account;
    if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
    let url = `${this.baseUrl}${path}`;
    let payload: string | undefined;
    if (method === 'GET' && body) url += `?${stripeForm(body)}`;
    if (method === 'POST') {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      payload = stripeForm(body ?? {}).toString();
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new CardError('Stripe didn’t answer. Try again in a moment.');
    }
    const text = await response.text();
    let json: { error?: { message?: string; code?: string } } & Record<string, unknown> = {};
    try {
      json = JSON.parse(text);
    } catch {
      // Not JSON: reported below by status.
    }
    if (!response.ok) {
      // Stripe's own message is meant for people ("Your card was declined", "Amount must be…").
      const message = json.error?.message ?? `Stripe answered ${response.status}.`;
      throw new CardError(
        message,
        response.status === 401 ? 503 : response.status >= 500 ? 502 : 400,
        json.error?.code ?? 'card_provider',
      );
    }
    return json as T;
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutCreated> {
    const session = await this.call<StripeSession>(
      'POST',
      '/v1/checkout/sessions',
      {
        mode: 'payment',
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        customer_email: input.customerEmail || undefined,
        // The link lasts 24 hours, Stripe's longest.
        expires_at: Math.floor(Date.now() / 1000) + 23.5 * 3600,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.amountMinor,
              product_data: {
                name: input.kind === 'deposit' ? `Damage deposit (held, not charged)` : input.description,
                description: input.kind === 'deposit' ? input.description : undefined,
              },
            },
          },
        ],
        metadata: input.metadata,
        payment_intent_data: {
          capture_method: input.kind === 'deposit' ? 'manual' : 'automatic',
          description: input.description,
          metadata: input.metadata,
        },
      },
      input.idempotencyKey,
    );
    if (!session.url) throw new CardError('Stripe made no payment page.');
    return { sessionId: session.id, url: session.url, expiresAt: new Date(session.expires_at * 1000) };
  }

  async checkout(sessionId: string): Promise<CheckoutState> {
    const s = await this.call<StripeSession>(
      'GET',
      `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      {
        expand: ['payment_intent'],
      },
    );
    const pi = typeof s.payment_intent === 'object' && s.payment_intent ? s.payment_intent : null;
    return {
      session: s.status,
      paymentIntentId: pi?.id ?? (typeof s.payment_intent === 'string' ? s.payment_intent : null),
      intent: pi?.status ?? null,
      receivedMinor: pi?.amount_received ?? 0,
      capturableMinor: pi?.amount_capturable ?? 0,
    };
  }

  async expireCheckout(sessionId: string): Promise<void> {
    await this.call('POST', `/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`);
  }

  async capture(paymentIntentId: string, amountMinor: number): Promise<void> {
    await this.call(
      'POST',
      `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}/capture`,
      { amount_to_capture: amountMinor },
      `capture-${paymentIntentId}`,
    );
  }

  async release(paymentIntentId: string): Promise<void> {
    await this.call('POST', `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`);
  }
}

/**
 * The stand-in: no network, no money. Tests drive it (`pay`, `hold`, `expire`); the demo uses it
 * so the screens work without a key.
 */
export class MemoryCardGateway implements CardGateway {
  readonly live = false;
  readonly sessions = new Map<
    string,
    { input: CheckoutInput; state: CheckoutState; captured?: number; released?: boolean }
  >();

  async createCheckout(input: CheckoutInput): Promise<CheckoutCreated> {
    const sessionId = `cs_test_${randomUUID().replace(/-/g, '')}`;
    this.sessions.set(sessionId, {
      input,
      state: { session: 'open', paymentIntentId: null, intent: null, receivedMinor: 0, capturableMinor: 0 },
    });
    return {
      sessionId,
      url: `https://checkout.stripe.test/pay/${sessionId}`,
      expiresAt: new Date(Date.now() + 23.5 * 3600_000),
    };
  }

  private get(sessionId: string) {
    const s = this.sessions.get(sessionId);
    if (!s) throw new CardError('No such payment page.', 404, 'resource_missing');
    return s;
  }

  async checkout(sessionId: string): Promise<CheckoutState> {
    return { ...this.get(sessionId).state };
  }

  async expireCheckout(sessionId: string): Promise<void> {
    const s = this.get(sessionId);
    if (s.state.session !== 'open') throw new CardError('That payment page is no longer open.', 400);
    s.state.session = 'expired';
  }

  async capture(paymentIntentId: string, amountMinor: number): Promise<void> {
    const s = [...this.sessions.values()].find((x) => x.state.paymentIntentId === paymentIntentId);
    if (s?.state.intent !== 'requires_capture') throw new CardError('Nothing is held.', 400);
    if (amountMinor > s.state.capturableMinor) throw new CardError('More than is held.', 400);
    s.state = { ...s.state, intent: 'succeeded', receivedMinor: amountMinor, capturableMinor: 0 };
  }

  async release(paymentIntentId: string): Promise<void> {
    const s = [...this.sessions.values()].find((x) => x.state.paymentIntentId === paymentIntentId);
    if (s?.state.intent !== 'requires_capture') throw new CardError('Nothing is held.', 400);
    s.state = { ...s.state, intent: 'canceled', capturableMinor: 0 };
  }

  /** The guest pays (a payment) or lets the deposit be held. */
  complete(sessionId: string): void {
    const s = this.get(sessionId);
    const amount = s.input.amountMinor;
    s.state =
      s.input.kind === 'deposit'
        ? {
            session: 'complete',
            paymentIntentId: `pi_${sessionId}`,
            intent: 'requires_capture',
            receivedMinor: 0,
            capturableMinor: amount,
          }
        : {
            session: 'complete',
            paymentIntentId: `pi_${sessionId}`,
            intent: 'succeeded',
            receivedMinor: amount,
            capturableMinor: 0,
          };
  }
}

/**
 * Checks the Stripe-Signature header: t=<seconds>,v1=<hex HMAC-SHA256 of "t.body">. Rejects a
 * signature older than five minutes so a captured webhook can't be replayed later.
 */
export function verifyStripeSignature(input: {
  rawBody: string;
  header: string | undefined;
  secret: string;
  now?: number;
  toleranceSeconds?: number;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.header) return { ok: false, reason: 'missing' };
  const parts = input.header.split(',').map((p) => p.trim().split('=') as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!Number.isFinite(t) || signatures.length === 0) return { ok: false, reason: 'malformed' };
  const now = input.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (input.toleranceSeconds ?? 300)) return { ok: false, reason: 'too_old' };
  const expected = createHmac('sha256', input.secret).update(`${t}.${input.rawBody}`).digest();
  const match = signatures.some((sig) => {
    const given = Buffer.from(sig, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  return match ? { ok: true } : { ok: false, reason: 'mismatch' };
}

/** For tests: a header Stripe would send for this body. */
export function signStripeBody(rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${v1}`;
}
