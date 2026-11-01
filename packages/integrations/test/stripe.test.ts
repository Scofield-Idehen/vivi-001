import { describe, expect, it } from 'vitest';
import { StripeGateway, signStripeBody, stripeForm, verifyStripeSignature } from '../src/index.ts';

describe('Stripe', () => {
  it('encodes nested fields the way Stripe reads them', () => {
    const form = stripeForm({
      a: 1,
      line_items: [{ price_data: { unit_amount: 500 } }],
      expand: ['x'],
      skip: undefined,
    });
    expect(form.toString()).toBe(
      'a=1&line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=500&expand%5B0%5D=x',
    );
  });

  it('checks webhook signatures, and refuses old or wrong ones', () => {
    const body = '{"type":"checkout.session.completed"}';
    const now = 1_800_000_000;
    const header = signStripeBody(body, 'whsec_abc', now);
    expect(verifyStripeSignature({ rawBody: body, header, secret: 'whsec_abc', now })).toEqual({ ok: true });
    expect(verifyStripeSignature({ rawBody: body, header, secret: 'whsec_other', now }).ok).toBe(false);
    expect(verifyStripeSignature({ rawBody: `${body} `, header, secret: 'whsec_abc', now }).ok).toBe(false);
    expect(verifyStripeSignature({ rawBody: body, header, secret: 'whsec_abc', now: now + 600 }).ok).toBe(
      false,
    );
    expect(verifyStripeSignature({ rawBody: body, header: undefined, secret: 'whsec_abc' }).ok).toBe(false);
  });

  it('asks for a held deposit, and reads a session back', async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const fake: typeof fetch = async (url, init) => {
      sent.push({ url: String(url), init: init ?? {} });
      if (String(url).includes('/v1/checkout/sessions?') || init?.method === 'POST')
        return new Response(
          JSON.stringify({
            id: 'cs_1',
            url: 'https://checkout.stripe.com/c/cs_1',
            status: 'open',
            expires_at: 2,
            payment_intent: null,
          }),
        );
      return new Response(
        JSON.stringify({
          id: 'cs_1',
          url: null,
          status: 'complete',
          expires_at: 2,
          payment_intent: {
            id: 'pi_1',
            status: 'requires_capture',
            amount_received: 0,
            amount_capturable: 20000,
          },
        }),
      );
    };
    const g = new StripeGateway({ secretKey: 'sk_test_123', fetch: fake });
    expect(g.live).toBe(false);
    const made = await g.createCheckout({
      kind: 'deposit',
      amountMinor: 20000,
      currency: 'GBP',
      description: 'Stay',
      successUrl: 'https://app/paid',
      cancelUrl: 'https://app/paid?not=1',
      metadata: { v01_org: 'o', v01_request: 'r' },
      idempotencyKey: 'v01-r',
    });
    expect(made.sessionId).toBe('cs_1');
    const form = new URLSearchParams(String(sent[0]!.init.body));
    expect(form.get('payment_intent_data[capture_method]')).toBe('manual');
    expect(form.get('line_items[0][price_data][currency]')).toBe('gbp');
    expect(form.get('metadata[v01_request]')).toBe('r');
    expect((sent[0]!.init.headers as Record<string, string>)['idempotency-key']).toBe('v01-r');
    const state = await g.checkout('cs_1');
    expect(state).toMatchObject({
      session: 'complete',
      paymentIntentId: 'pi_1',
      intent: 'requires_capture',
      capturableMinor: 20000,
    });
    expect(sent[1]!.url).toContain('expand%5B0%5D=payment_intent');
    expect(new StripeGateway({ secretKey: 'sk_live_123' }).live).toBe(true);
  });
});
