import { z } from 'zod';

/**
 * Where a property stands with the channel manager (integration step 3). Connecting makes the
 * property in Channex; linking its Airbnb, Booking.com and Vrbo listings to it comes later (step 7),
 * and nothing reaches a channel until then.
 */
export const CHANNEX_STATES = ['not_connected', 'connecting', 'connected', 'failed'] as const;
export type ChannexConnection = (typeof CHANNEX_STATES)[number];

export const CHANNEX_STATE_LABELS: Record<ChannexConnection, string> = {
  not_connected: 'Not connected to Channex',
  connecting: 'Connecting to Channex',
  connected: 'Connected to Channex',
  failed: 'Couldn’t connect to Channex',
};

export const ChannexStateSchema = z.object({
  status: z.enum(CHANNEX_STATES),
  /** Channex's own id for the property, once made. */
  channexPropertyId: z.string().nullable(),
  /** Who asked, and when; null until someone has. */
  requestedBy: z.string().nullable(),
  requestedAt: z.string().nullable(),
  /** When Channex had it, or when the attempts were given up. */
  finishedAt: z.string().nullable(),
  /** The last thing that went wrong, while connecting or after giving up. */
  error: z.string().nullable(),
  attempts: z.number().int(),
  /**
   * Whether Channex closes a booked night by itself, as last checked by the worker: true, false
   * (off in Channex, being turned back on), or null when not yet checked or not connected.
   */
  autoClose: z.boolean().nullable(),
  autoCloseCheckedAt: z.string().nullable(),
});
export type ChannexState = z.infer<typeof ChannexStateSchema>;

/** What "Connect all" queued: how many were asked for, and how many were already in hand. */
export const ConnectAllResultSchema = z.object({
  queued: z.number().int(),
  alreadyConnected: z.number().int(),
  alreadyConnecting: z.number().int(),
});
export type ConnectAllResult = z.infer<typeof ConnectAllResultSchema>;
