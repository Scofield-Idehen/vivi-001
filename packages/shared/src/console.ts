import { z } from 'zod';
import { CHANNELS, MEMBER_ROLES } from './enums.ts';
import { Uuid } from './schemas.ts';

/**
 * The V-01 console: what V-01 staff see across every operator.
 * Totals, statuses and operator metadata only. Guests' details never appear here;
 * reading an operator's own data needs a support grant (see SupportAccessStartSchema).
 */

const Count = z.number().int().min(0);
/** ISO 8601 date and time. */
const Timestamp = z.string();

export const OPERATOR_STATUSES = ['live', 'onboarding'] as const;
export type OperatorStatus = (typeof OPERATOR_STATUSES)[number];

export const OPERATOR_STATUS_LABELS: Record<OperatorStatus, string> = {
  live: 'Live',
  onboarding: 'Onboarding',
};

export const ConsoleOverviewSchema = z.object({
  operators: Count,
  /** Operators with at least one property whose channels V-01 now runs. */
  operatorsLive: Count,
  properties: Count,
  propertiesOnV01: Count,
  arrivalsToday: Count,
  departuresToday: Count,
  bookingsLast7Days: Count,
  outboxWaiting: Count,
  outboxFailed: Count,
  webhooksWaiting: Count,
  webhooksFailed: Count,
  supportSessionsActive: Count,
  lastSentAt: Timestamp.nullable(),
  generatedAt: Timestamp,
});
export type ConsoleOverview = z.infer<typeof ConsoleOverviewSchema>;

export const ConsoleOperatorSchema = z.object({
  id: Uuid,
  name: z.string(),
  slug: z.string(),
  createdAt: Timestamp,
  status: z.enum(OPERATOR_STATUSES),
  properties: Count,
  propertiesOnV01: Count,
  members: Count,
  channelAccounts: Count,
  channelAccountsConnected: Count,
  /** Channels with at least one connected account. */
  channels: z.array(z.enum(CHANNELS)),
  outboxWaiting: Count,
  outboxFailed: Count,
  webhooksFailed: Count,
  lastActivityAt: Timestamp.nullable(),
  supportActive: z.boolean(),
});
export type ConsoleOperator = z.infer<typeof ConsoleOperatorSchema>;

export const ConsoleOperatorListSchema = z.object({ operators: z.array(ConsoleOperatorSchema) });
export type ConsoleOperatorList = z.infer<typeof ConsoleOperatorListSchema>;

export const SupportGrantSchema = z.object({
  id: Uuid,
  organisationId: Uuid,
  organisationName: z.string(),
  staffEmail: z.string(),
  reason: z.string(),
  startedAt: Timestamp,
  expiresAt: Timestamp,
  endedAt: Timestamp.nullable(),
  active: z.boolean(),
  /** Pages and requests made under this grant, each one logged. */
  requests: Count,
});
export type SupportGrant = z.infer<typeof SupportGrantSchema>;

export const SupportGrantListSchema = z.object({ grants: z.array(SupportGrantSchema) });
export type SupportGrantList = z.infer<typeof SupportGrantListSchema>;

export const ConsoleTeamMemberSchema = z.object({
  email: z.string(),
  fullName: z.string().nullable(),
  role: z.enum(MEMBER_ROLES),
  status: z.enum(['active', 'invited']),
  since: Timestamp,
  lastSeenAt: Timestamp.nullable(),
});
export type ConsoleTeamMember = z.infer<typeof ConsoleTeamMemberSchema>;

export const ConsoleOperatorDetailSchema = z.object({
  operator: ConsoleOperatorSchema.extend({
    legalName: z.string().nullable(),
    displayName: z.string().nullable(),
    currency: z.string().nullable(),
    timeZone: z.string().nullable(),
    countryCode: z.string().nullable(),
  }),
  /** Null when the viewer's role may not see people's names and emails. */
  team: z.array(ConsoleTeamMemberSchema).nullable(),
  support: z.array(SupportGrantSchema),
});
export type ConsoleOperatorDetail = z.infer<typeof ConsoleOperatorDetailSchema>;

export const ConsoleSyncRowSchema = z.object({
  /** Null for webhooks not yet matched to any operator's property. */
  organisationId: Uuid.nullable(),
  organisationName: z.string().nullable(),
  outboxWaiting: Count,
  outboxFailed: Count,
  oldestWaitingAt: Timestamp.nullable(),
  lastSentAt: Timestamp.nullable(),
  webhooksWaiting: Count,
  webhooksFailed: Count,
  lastWebhookAt: Timestamp.nullable(),
});
export type ConsoleSyncRow = z.infer<typeof ConsoleSyncRowSchema>;

export const ConsoleSyncErrorSchema = z.object({
  source: z.enum(['outbox', 'webhook']),
  organisationId: Uuid.nullable(),
  organisationName: z.string().nullable(),
  at: Timestamp,
  attempts: Count,
  message: z.string(),
});
export type ConsoleSyncError = z.infer<typeof ConsoleSyncErrorSchema>;

export const ConsoleSyncSchema = z.object({
  rows: z.array(ConsoleSyncRowSchema),
  errors: z.array(ConsoleSyncErrorSchema),
  generatedAt: Timestamp,
});
export type ConsoleSync = z.infer<typeof ConsoleSyncSchema>;

/** What an operator sees about V-01 support visits to their own workspace. */
export const SupportVisitSchema = z.object({
  id: Uuid,
  staffEmail: z.string(),
  reason: z.string(),
  startedAt: Timestamp,
  expiresAt: Timestamp,
  endedAt: Timestamp.nullable(),
});
export type SupportVisit = z.infer<typeof SupportVisitSchema>;

export const SupportVisitListSchema = z.object({ visits: z.array(SupportVisitSchema) });
export type SupportVisitList = z.infer<typeof SupportVisitListSchema>;

/** Support access lasts between 5 minutes and 4 hours, and always needs a reason the operator can read. */
export const SupportAccessStartSchema = z.object({
  reason: z.string().trim().min(5, 'Give a reason of at least 5 characters').max(500),
  minutes: z.number().int().min(5).max(240),
});
export type SupportAccessStart = z.input<typeof SupportAccessStartSchema>;

export const SUPPORT_DURATIONS = [
  { minutes: 15, label: '15 minutes' },
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
] as const;
