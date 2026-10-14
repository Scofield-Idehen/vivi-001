import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Channex signs webhooks with HMAC-SHA256 over "{timestamp}.{raw body}" and sends:
 *   x-hmac-timestamp       Unix seconds
 *   x-hmac-signature-256   lowercase hex; two comma-separated values during key rotation
 *   x-hmac-keys-256        key labels in the same order
 * The body must be verified as the exact raw bytes, before JSON parsing.
 */

export type HeaderBag = Record<string, string | string[] | undefined>;

export type WebhookCheck =
  | { ok: true }
  | { ok: false; reason: 'missing_signature' | 'stale_timestamp' | 'bad_signature' };

function header(headers: HeaderBag, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function sign(secret: string, timestamp: string, rawBody: string | Buffer): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
}

function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length || !/^[0-9a-f]+$/.test(a)) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export function verifyChannexWebhook(input: {
  rawBody: string | Buffer;
  headers: HeaderBag;
  secret: string;
  toleranceSeconds?: number;
  nowSeconds?: number;
}): WebhookCheck {
  const timestamp = header(input.headers, 'x-hmac-timestamp');
  const signatures = header(input.headers, 'x-hmac-signature-256');
  if (!timestamp || !signatures) return { ok: false, reason: 'missing_signature' };

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? 300;
  if (!/^\d+$/.test(timestamp) || Math.abs(now - Number(timestamp)) > tolerance) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const expected = sign(input.secret, timestamp, input.rawBody);
  const match = signatures
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .some((candidate) => sameHex(candidate, expected));
  return match ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

/** Builds the headers Channex would send. For tests and local tools. */
export function signChannexWebhook(
  rawBody: string,
  secret: string,
  timestampSeconds = Math.floor(Date.now() / 1000),
): Record<string, string> {
  const timestamp = String(timestampSeconds);
  return {
    'x-hmac-timestamp': timestamp,
    'x-hmac-signature-256': sign(secret, timestamp, rawBody),
    'x-hmac-keys-256': `...${secret.slice(-6)}`,
  };
}

export const ChannexWebhookSchema = z.object({
  event: z.string(),
  property_id: z.string().nullable().optional(),
  user_id: z.string().nullable().optional(),
  timestamp: z.string().nullable().optional(),
  payload: z.unknown().optional(),
});
export type ChannexWebhook = z.infer<typeof ChannexWebhookSchema>;

/** Booking events are signals: the worker always pulls the latest revision rather than trusting the payload. */
export const CHANNEX_BOOKING_EVENTS = new Set([
  'booking',
  'booking_new',
  'booking_modification',
  'booking_cancellation',
  'booking_unmapped_room',
  'booking_unmapped_rate',
  'non_acked_booking',
]);
