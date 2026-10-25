import { z } from 'zod';

/**
 * Smart locks (TTLock first). An operator connects the TTLock account that owns its locks once;
 * V-01 keeps a token, never the password. Each lock is put on a property, and where "makes codes"
 * is on, the worker gives every stay its own code from check-in to check-out and every job on the
 * field team a code for its day only. Codes are secret: sealed in the database, shown only to
 * people who may read secrets, the guest on their own page, and the crew inside their job.
 */

const Timestamp = z.string();

export const LOCK_CODE_KINDS = ['guest', 'crew'] as const;
export type LockCodeKind = (typeof LOCK_CODE_KINDS)[number];

/** `pending`: waiting to go to the lock; `set`: on the lock; `failed`: refused, tried again; `removed`: taken off. */
export const LOCK_CODE_STATUSES = ['pending', 'set', 'failed', 'removed'] as const;
export type LockCodeStatus = (typeof LOCK_CODE_STATUSES)[number];

/** Below this, a lock's battery shows on Today. */
export const LOW_BATTERY = 25;

/** Guest codes are made this many days before arrival, so they go into the arrival messages. */
export const GUEST_CODE_DAYS_AHEAD = 14;

/** Crew codes work on the job's day only, between these local times. */
export const CREW_CODE_FROM = '07:00';
export const CREW_CODE_UNTIL = '22:00';

/** Guest codes stay open this long after the check-out time. */
export const CHECK_OUT_GRACE_MINUTES = 30;

export const LockSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  propertyId: z.uuid().nullable(),
  propertyName: z.string().nullable(),
  /** Per cent, as the lock last reported it. */
  battery: z.number().int().nullable(),
  /** On a gateway, so codes can be sent from far away. Without one, codes can't be sent. */
  hasGateway: z.boolean(),
  makesCodes: z.boolean(),
  lastSeenAt: Timestamp.nullable(),
});
export type Lock = z.infer<typeof LockSchema>;

export const GatewaySchema = z.object({ name: z.string(), online: z.boolean() });
export type Gateway = z.infer<typeof GatewaySchema>;

export const LockAccountSchema = z.object({
  username: z.string(),
  status: z.enum(['connected', 'error']),
  error: z.string().nullable(),
  syncedAt: Timestamp.nullable(),
  gateways: z.array(GatewaySchema),
});
export type LockAccount = z.infer<typeof LockAccountSchema>;

export const LocksViewSchema = z.object({
  /** Whether V-01 itself has TTLock developer credentials; without them nothing can be connected. */
  available: z.boolean(),
  account: LockAccountSchema.nullable(),
  locks: z.array(LockSchema),
  /** Codes that failed to reach a lock and are waiting to be tried again. */
  failedCodes: z.number().int(),
});
export type LocksView = z.infer<typeof LocksViewSchema>;

export const LockConnectSchema = z.object({
  /** The TTLock app's sign-in (email or phone), not the developer account. */
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
});
export type LockConnect = z.input<typeof LockConnectSchema>;

export const LockUpdateSchema = z
  .object({
    propertyId: z.uuid().nullable().optional(),
    makesCodes: z.boolean().optional(),
  })
  .refine((b) => b.propertyId !== undefined || b.makesCodes !== undefined, 'Nothing to change');
export type LockUpdate = z.input<typeof LockUpdateSchema>;

/** A code as the office sees it on a booking: the digits only for people who may read secrets. */
export const DoorCodeSchema = z.object({
  lockName: z.string(),
  code: z.string().nullable(),
  status: z.enum(LOCK_CODE_STATUSES),
  startsAt: Timestamp,
  endsAt: Timestamp,
  error: z.string().nullable(),
});
export type DoorCode = z.infer<typeof DoorCodeSchema>;

/** A fresh code: six digits, not starting with 0, no digit four times in a row. */
export function makeDoorCode(random: () => number = Math.random): string {
  for (;;) {
    let code = String(1 + Math.floor(random() * 9));
    while (code.length < 6) code += String(Math.floor(random() * 10));
    if (!/(\d)\1{3}/.test(code) && !'123456 234567 345678 456789 987654 876543'.includes(code)) return code;
  }
}
