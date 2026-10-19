import { z } from 'zod';
import { CHANNELS } from './enums.ts';

/**
 * The Today page: what the team deals with today, and what needs a person. Guesty's dashboard is
 * the measure; V-01's version leads with the problems, because arrivals take care of themselves and
 * a booking sold twice does not.
 */

const Uuid = z.uuid();

/** A stay arriving or leaving today. */
export const TodayStaySchema = z.object({
  reservationId: Uuid,
  propertyId: Uuid,
  propertyName: z.string(),
  guestName: z.string().nullable(),
  channel: z.enum(CHANNELS),
  checkIn: z.string(),
  checkOut: z.string(),
  nights: z.number().int(),
  /** The time agreed for the stay, "15:00", when one was. */
  time: z.string().nullable(),
  guests: z.number().int(),
});
export type TodayStay = z.infer<typeof TodayStaySchema>;

export const ATTENTION_SEVERITIES = ['urgent', 'warning'] as const;

/** One thing a person has to look at, with where in the app to do it. */
export const AttentionItemSchema = z.object({
  id: z.string(),
  severity: z.enum(ATTENTION_SEVERITIES),
  title: z.string(),
  detail: z.string().nullable(),
  /** A path inside the app, such as /properties/…; null when there is nowhere better than here. */
  to: z.string().nullable(),
});
export type AttentionItem = z.infer<typeof AttentionItemSchema>;

export const TodaySchema = z.object({
  /** Today where the operator is. */
  date: z.string(),
  arrivals: z.array(TodayStaySchema),
  departures: z.array(TodayStaySchema),
  /** Stays in the house tonight, arrivals included. */
  staying: z.number().int(),
  cleansDue: z.array(z.object({ propertyId: Uuid, propertyName: z.string(), since: z.string().nullable() })),
  attention: z.array(AttentionItemSchema),
  /** When the worker last reported in; null when it never has. */
  workerSeenAt: z.string().nullable(),
});
export type Today = z.infer<typeof TodaySchema>;
