import { z } from 'zod';
import { CHANNELS, RESERVATION_STATUSES } from './enums.ts';

/**
 * The Inbox (design roadmap, Phase 2, D2): one thread per booking, whichever site the guest booked
 * on. A guest on Airbnb or Booking.com keeps talking inside that site's chat; their messages come
 * into the thread through Channex and a reply goes back the same way, so the guest never notices.
 * A direct guest is reached by email or text from V-01 itself. Automatic messages (a confirmation,
 * the day before arrival with the stay link, the check-out reminder) are templates sent into the
 * same threads by the worker.
 */

const Uuid = z.uuid();
const Timestamp = z.string();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date like 2026-11-05');
const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'A time like 10:00');

/** The way a message travelled: a site's own chat (through Channex), or email or a text from V-01. */
export const MESSAGE_VIAS = ['airbnb', 'booking_com', 'vrbo', 'expedia', 'email', 'sms'] as const;
export type MessageVia = (typeof MESSAGE_VIAS)[number];

export const MESSAGE_VIA_LABELS: Record<MessageVia, string> = {
  airbnb: 'Airbnb chat',
  booking_com: 'Booking.com chat',
  vrbo: 'Vrbo chat',
  expedia: 'Expedia chat',
  email: 'email',
  sms: 'text message',
};

/**
 * `received`: from the guest. `queued`: written, the worker sends it next. `sent`: gone.
 * `waiting`: the worker has nothing to send it with yet (no email sender set up, or the site's chat
 * not connected); it goes as soon as there is. `failed`: the sender refused it; the reason is kept.
 */
export const MESSAGE_STATUSES = ['received', 'queued', 'sent', 'waiting', 'failed'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_MAX = 8000;

export const MessageSchema = z.object({
  id: Uuid,
  threadId: Uuid,
  direction: z.enum(['in', 'out']),
  via: z.enum(MESSAGE_VIAS),
  body: z.string(),
  status: z.enum(MESSAGE_STATUSES),
  /** Why it is waiting or failed, in words for the team. */
  note: z.string().nullable(),
  /** Who wrote it, for the team's own messages; null for the guest's and for automatic ones. */
  sentBy: z.string().nullable(),
  /** Sent by the worker from a template. */
  automatic: z.boolean(),
  templateName: z.string().nullable(),
  at: Timestamp,
  sentAt: Timestamp.nullable(),
});
export type Message = z.infer<typeof MessageSchema>;

export const THREAD_STATUSES = ['open', 'done'] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

/** One guest's conversation: the booking it belongs to and where it stands. */
export const ThreadSchema = z.object({
  id: Uuid,
  reservationId: Uuid,
  propertyId: Uuid,
  propertyName: z.string(),
  guestName: z.string().nullable(),
  guestEmail: z.string().nullable(),
  guestPhone: z.string().nullable(),
  channel: z.enum(CHANNELS),
  reservationStatus: z.enum(RESERVATION_STATUSES),
  checkIn: Day,
  checkOut: Day,
  /** `done`: handled for now; a new message from the guest opens it again. */
  status: z.enum(THREAD_STATUSES),
  /** How a reply reaches this guest; null when there is no way yet (no email or phone on the booking). */
  via: z.enum(MESSAGE_VIAS).nullable(),
  lastMessageAt: Timestamp.nullable(),
  lastMessage: z.object({ direction: z.enum(['in', 'out']), body: z.string(), at: Timestamp }).nullable(),
  /** Messages from the guest nobody has opened yet. */
  unread: z.number().int(),
  /** When the guest last wrote without an answer since; the response timer counts from here. */
  awaitingSince: Timestamp.nullable(),
});
export type Thread = z.infer<typeof ThreadSchema>;

export const THREAD_VIEWS = ['awaiting', 'open', 'all'] as const;
export type ThreadView = (typeof THREAD_VIEWS)[number];

export const ThreadListQuerySchema = z.object({
  view: z.enum(THREAD_VIEWS).default('open'),
  q: z.string().max(120).optional(),
});
export type ThreadListQuery = z.infer<typeof ThreadListQuerySchema>;

export const ThreadListSchema = z.object({
  threads: z.array(ThreadSchema),
  counts: z.object({ awaiting: z.number().int(), open: z.number().int() }),
});
export type ThreadList = z.infer<typeof ThreadListSchema>;

export const ThreadDetailSchema = z.object({
  thread: ThreadSchema,
  messages: z.array(MessageSchema),
});
export type ThreadDetail = z.infer<typeof ThreadDetailSchema>;

export const MessageSendSchema = z.object({
  body: z.string().trim().min(1, 'Write something first.').max(MESSAGE_MAX),
  /** For a direct guest with both an email and a phone: which to use. Otherwise the thread's way. */
  via: z.enum(['email', 'sms']).optional(),
});
export type MessageSend = z.infer<typeof MessageSendSchema>;

export const ThreadUpdateSchema = z.object({
  status: z.enum(THREAD_STATUSES).optional(),
  /** Opened: the guest's messages count as read. */
  read: z.literal(true).optional(),
});
export type ThreadUpdate = z.infer<typeof ThreadUpdateSchema>;

// Templates ---------------------------------------------------------------------------------------

/**
 * When a template goes out by itself. `manual` is a saved reply: picked from the list while writing.
 */
export const MESSAGE_TRIGGERS = [
  'booking_confirmed',
  'before_arrival',
  'arrival_day',
  'before_departure',
  'manual',
] as const;
export type MessageTrigger = (typeof MESSAGE_TRIGGERS)[number];

export const MESSAGE_TRIGGER_LABELS: Record<MessageTrigger, string> = {
  booking_confirmed: 'When a booking is confirmed',
  before_arrival: 'The day before arrival',
  arrival_day: 'On the day of arrival',
  before_departure: 'The day before check-out',
  manual: 'Saved reply',
};

/** The words a template may use; each is replaced for the guest it goes to. */
export const TEMPLATE_PLACEHOLDERS = [
  { key: 'guest_first_name', label: "The guest's first name" },
  { key: 'guest_name', label: "The guest's full name" },
  { key: 'property', label: "The home's name" },
  { key: 'check_in', label: 'The arrival day, "Thursday 5 November"' },
  { key: 'check_in_time', label: 'Check-in from, "15:00"' },
  { key: 'check_out', label: 'The departure day' },
  { key: 'check_out_time', label: 'Check-out by, "10:00"' },
  { key: 'nights', label: 'How many nights' },
  { key: 'stay_link', label: "The guest's private page for their stay" },
  { key: 'door_code', label: 'The stay\u2019s door code, once the smart lock has it' },
  { key: 'operator', label: 'Your name, as guests see it' },
] as const;
export type TemplatePlaceholder = (typeof TEMPLATE_PLACEHOLDERS)[number]['key'];

export const TEMPLATE_NAME_MAX = 80;

export const MessageTemplateSchema = z.object({
  id: Uuid,
  name: z.string(),
  trigger: z.enum(MESSAGE_TRIGGERS),
  /** For the day triggers: when that day, "10:00" where the operator is. Null for the rest. */
  sendTime: z.string().nullable(),
  body: z.string(),
  enabled: z.boolean(),
  position: z.number().int(),
});
export type MessageTemplate = z.infer<typeof MessageTemplateSchema>;

export const MessageTemplateListSchema = z.object({ templates: z.array(MessageTemplateSchema) });
export type MessageTemplateList = z.infer<typeof MessageTemplateListSchema>;

export const MessageTemplateCreateSchema = z.object({
  name: z.string().trim().min(1).max(TEMPLATE_NAME_MAX),
  trigger: z.enum(MESSAGE_TRIGGERS),
  sendTime: Clock.nullable().optional(),
  body: z.string().trim().min(1).max(MESSAGE_MAX),
  enabled: z.boolean().optional(),
});
export type MessageTemplateCreate = z.infer<typeof MessageTemplateCreateSchema>;

export const MessageTemplateUpdateSchema = MessageTemplateCreateSchema.partial();
export type MessageTemplateUpdate = z.infer<typeof MessageTemplateUpdateSchema>;

/** The words to fill a template with, for one guest and stay. */
export type TemplateValues = Record<TemplatePlaceholder, string>;

/** Replaces each {{placeholder}} in a template; unknown ones are left as written. */
export function renderTemplate(body: string, values: TemplateValues): string {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (whole, key: string) =>
    key in values ? values[key as TemplatePlaceholder] : whole,
  );
}

/** The placeholders a template uses that don't exist, for a warning while editing. */
export function unknownPlaceholders(body: string): string[] {
  const known = new Set<string>(TEMPLATE_PLACEHOLDERS.map((p) => p.key));
  const found = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)) {
    const key = m[1] as string;
    if (!known.has(key)) found.add(key);
  }
  return [...found];
}

const LONG_DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

/** "Thursday 5 November" from "2026-11-05", for the words in a message. */
export function longDay(day: string): string {
  return LONG_DAY.format(new Date(`${day}T12:00:00Z`)).replace(',', '');
}
