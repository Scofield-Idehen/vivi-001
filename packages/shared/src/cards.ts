import { z } from 'zod';

/**
 * Asking a guest to pay by card, or to let a damage deposit be held (1 Nov 2026). Stripe's page
 * takes the card; ViVi OS keeps the request and what became of it.
 */

export const CARD_KINDS = ['payment', 'deposit'] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/**
 * open      the link is out, nothing paid yet
 * paid      a payment went through; it is on the booking
 * held      a deposit is held on the card, not charged
 * kept      some or all of a deposit was charged
 * released  a held deposit was let go
 * expired   the link ran out or was cancelled before anything was paid
 */
export const CARD_STATUSES = ['open', 'paid', 'held', 'kept', 'released', 'expired'] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];

export const CardRequestCreateSchema = z.object({
  kind: z.enum(CARD_KINDS),
  amountMinor: z.number().int().positive().max(10_000_000),
});
export type CardRequestCreate = z.infer<typeof CardRequestCreateSchema>;

export const CardKeepSchema = z.object({
  amountMinor: z.number().int().positive(),
  reason: z.string().trim().min(1).max(80),
});
export type CardKeep = z.infer<typeof CardKeepSchema>;

export const CardRequestSchema = z.object({
  id: z.uuid(),
  kind: z.enum(CARD_KINDS),
  status: z.enum(CARD_STATUSES),
  amountMinor: z.number().int(),
  currency: z.string(),
  /** The guest's link while it is open; null after. */
  url: z.string().nullable(),
  keptMinor: z.number().int().nullable(),
  keptReason: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  settledAt: z.string().nullable(),
});
export type CardRequest = z.infer<typeof CardRequestSchema>;

export const CardRequestListSchema = z.object({
  /** False until Stripe is set up for this workspace; the screens say so. */
  enabled: z.boolean(),
  /** True when the key is a test key: no real money moves. */
  testMode: z.boolean(),
  requests: z.array(CardRequestSchema),
  /** A deposit may be asked on this booking (not an Airbnb one unless the home allows it). */
  depositAllowed: z.boolean(),
  /** The home's deposit, to start the amount with. */
  depositMinor: z.number().int().nullable(),
});
export type CardRequestList = z.infer<typeof CardRequestListSchema>;
