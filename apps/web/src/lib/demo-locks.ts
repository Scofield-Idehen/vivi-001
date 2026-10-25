import {
  CHECK_OUT_GRACE_MINUTES,
  CREW_CODE_FROM,
  CREW_CODE_UNTIL,
  type DoorCode,
  GUEST_CODE_DAYS_AHEAD,
  type Lock,
  type LockAccount,
  type LocksView,
} from '@v01/shared';

/**
 * The demo's pretend TTLock: the same rules as the worker, worked out on the spot instead of sent
 * to a lock. Connecting takes any app login (a password of "wrong" is refused, to show the error);
 * three locks appear, one with a low battery and one without a gateway.
 */

export interface DemoLock extends Omit<Lock, 'propertyName'> {
  providerLockId: string;
}

export interface DemoLocks {
  account: LockAccount | null;
  locks: DemoLock[];
}

export const emptyLocks = (): DemoLocks => ({ account: null, locks: [] });

/** The same six digits for a stay or job every time the demo is asked. */
export function demoDoorCode(ownerId: string): string {
  let h = 2166136261;
  for (const ch of ownerId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return String(100000 + (h % 900000));
}

/** A local date and time where the operator is, as a UTC instant. */
export function zoned(date: string, time: string, timeZone: string): Date {
  const guess = new Date(`${date}T${time.slice(0, 5)}:00Z`);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(guess)
      .map((p) => [p.type, p.value]),
  );
  const local = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return new Date(guess.getTime() - (local - guess.getTime()));
}

export function connectDemoLocks(
  state: DemoLocks,
  username: string,
  password: string,
  homes: { id: string; name: string }[],
): DemoLocks {
  if (password === 'wrong') throw new Error('Invalid account or password');
  const now = new Date().toISOString();
  const first = homes[0]?.name ?? 'Home';
  const second = homes[1]?.name ?? 'Second home';
  const locks: DemoLock[] = state.locks.length
    ? state.locks
    : [
        { providerLockId: '61001', name: `${first} front door`, battery: 86, hasGateway: true },
        { providerLockId: '61002', name: `${second} keypad`, battery: 19, hasGateway: true },
        { providerLockId: '61003', name: 'Garden gate', battery: 64, hasGateway: false },
      ].map((l) => ({
        ...l,
        id: crypto.randomUUID(),
        propertyId: null,
        makesCodes: false,
        lastSeenAt: now,
      }));
  return {
    account: {
      username,
      status: 'connected',
      error: null,
      syncedAt: now,
      gateways: [{ name: 'G2 gateway', online: true }],
    },
    locks,
  };
}

export function demoLocksView(state: DemoLocks, homes: { id: string; name: string }[]): LocksView {
  const nameOf = (id: string | null) => homes.find((h) => h.id === id)?.name ?? null;
  return {
    available: true,
    account: state.account,
    locks: state.locks
      .map(({ providerLockId: _, ...l }) => ({ ...l, propertyName: nameOf(l.propertyId) }))
      .sort((a, b) =>
        a.propertyName === b.propertyName
          ? a.name.localeCompare(b.name)
          : a.propertyName === null
            ? 1
            : b.propertyName === null
              ? -1
              : a.propertyName.localeCompare(b.propertyName),
      ),
    failedCodes: 0,
  };
}

const codeLocks = (state: DemoLocks, propertyId: string) =>
  state.account?.status === 'connected'
    ? state.locks.filter((l) => l.propertyId === propertyId && l.makesCodes && l.hasGateway)
    : [];

/** A stay's codes, as the worker would have made them by now. */
export function demoStayCodes(
  state: DemoLocks,
  stay: {
    id: string;
    propertyId: string;
    status: string;
    checkIn: string;
    checkOut: string;
    checkInTime: string | null;
    checkOutTime: string | null;
  },
  property: { checkInTime: string; checkOutTime: string },
  timeZone: string,
  today: string,
  reveal: boolean,
): DoorCode[] {
  if (stay.status !== 'confirmed' || stay.checkOut < today) return [];
  const last = new Date(Date.parse(`${today}T00:00:00Z`) + GUEST_CODE_DAYS_AHEAD * 86_400_000)
    .toISOString()
    .slice(0, 10);
  if (stay.checkIn > last) return [];
  const startsAt = zoned(stay.checkIn, stay.checkInTime ?? property.checkInTime, timeZone);
  const endsAt = new Date(
    zoned(stay.checkOut, stay.checkOutTime ?? property.checkOutTime, timeZone).getTime() +
      CHECK_OUT_GRACE_MINUTES * 60_000,
  );
  return codeLocks(state, stay.propertyId).map((l) => ({
    lockName: l.name,
    code: reveal ? demoDoorCode(stay.id) : null,
    status: 'set',
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    error: null,
  }));
}

/** A job's code for its day, when a lock at the home makes codes. */
export function demoJobCode(
  state: DemoLocks,
  task: { id: string; propertyId: string; dueOn: string; status: string },
  timeZone: string,
  today: string,
): { name: string; kind: 'secret'; value: string } | null {
  if (task.status === 'cancelled' || task.dueOn !== today) return null;
  const locks = codeLocks(state, task.propertyId);
  if (!locks.length) return null;
  const ends = zoned(task.dueOn, CREW_CODE_UNTIL, timeZone);
  if (ends.getTime() < Date.now() || zoned(task.dueOn, CREW_CODE_FROM, timeZone).getTime() > ends.getTime())
    return null;
  return {
    name: `Door code (${locks.map((l) => l.name).join(', ')}), today only`,
    kind: 'secret',
    value: demoDoorCode(task.id),
  };
}
