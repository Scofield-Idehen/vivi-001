import {
  type Channel,
  GUEST_NAME_MAX,
  isEmail,
  isPhone,
  NOTES_MAX,
  nightsBetween,
  type Reservation,
  type ReservationStatus,
  type ReservationUpdate,
} from '@v01/shared';
import type { Status } from '../../components/ui.tsx';

/**
 * The reservation screens' model: how a booking is put into words, the form that changes it, and
 * the ways to reach its guest. Kept apart from the screens so it can be tested on its own.
 */

const DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const DAY_SHORT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/** "Wed 21 Oct 2026". */
export const dayLabel = (date: string) => DAY.format(utc(date)).replace(',', '');
/** "Wed 21 Oct". */
export const shortDay = (date: string) => DAY_SHORT.format(utc(date)).replace(',', '');

/** "Wed 21 Oct to Fri 23 Oct". */
export const datesLabel = (checkIn: string, checkOut: string) =>
  `${shortDay(checkIn)} to ${shortDay(checkOut)}`;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "2 adults, 1 child and 1 infant", or "1 adult". */
export function partyLabel(r: { adults: number; children: number; infants: number }): string {
  const parts = [count(r.adults, 'adult', 'adults')];
  if (r.children) parts.push(count(r.children, 'child', 'children'));
  if (r.infants) parts.push(count(r.infants, 'infant', 'infants'));
  return parts.length === 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

/** Where the stay is from today, in words: "Arrives tomorrow", "Staying now", "Left Mon 12 Oct". */
export function whenLabel(
  r: { status: ReservationStatus; checkIn: string; checkOut: string },
  today: string,
): string {
  if (r.status === 'cancelled') return 'Cancelled';
  if (today < r.checkIn) {
    const days = nightsBetween(today, r.checkIn);
    return days === 1 ? 'Arrives tomorrow' : `Arrives in ${days} days`;
  }
  if (today === r.checkIn) return 'Arrives today';
  if (today < r.checkOut) return 'Staying now';
  if (today === r.checkOut) return 'Leaves today';
  return `Left ${shortDay(r.checkOut)}`;
}

/** A booking's status as a dot: green confirmed, red overlapping, amber waiting, grey cancelled. */
export const STATUS_TONES: Record<ReservationStatus, Status> = {
  confirmed: 'done',
  conflict: 'urgent',
  request: 'pending',
  inquiry: 'pending',
  cancelled: 'neutral',
};

/** The stay's times: agreed for this stay, or the property's usual ones. */
export function stayTimes(r: Reservation): {
  checkIn: string;
  checkOut: string;
  checkInAgreed: boolean;
  checkOutAgreed: boolean;
} {
  return {
    checkIn: r.checkInTime ?? r.propertyCheckInTime,
    checkOut: r.checkOutTime ?? r.propertyCheckOutTime,
    checkInAgreed: r.checkInTime !== null,
    checkOutAgreed: r.checkOutTime !== null,
  };
}

// The form that changes a booking -------------------------------------------------------------------

export interface ReservationForm {
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  /** Empty: the property's usual time. */
  checkInTime: string;
  checkOutTime: string;
  notes: string;
}

export type ReservationFormErrors = Partial<Record<keyof ReservationForm, string>>;

export function formFrom(r: Reservation): ReservationForm {
  return {
    guestName: r.guestName ?? '',
    guestEmail: r.guestEmail ?? '',
    guestPhone: r.guestPhone ?? '',
    checkInTime: r.checkInTime ?? '',
    checkOutTime: r.checkOutTime ?? '',
    notes: r.notes ?? '',
  };
}

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * What to send: only what changed, checked first. A time set back to the property's usual one is
 * sent as none of its own. Nothing changed: no update and no errors.
 */
export function toUpdate(
  form: ReservationForm,
  r: Reservation,
): { update: ReservationUpdate | null; errors: ReservationFormErrors } {
  const errors: ReservationFormErrors = {};
  const before = formFrom(r);
  const value = {
    guestName: form.guestName.trim(),
    guestEmail: form.guestEmail.trim(),
    guestPhone: form.guestPhone.trim(),
    checkInTime: form.checkInTime === r.propertyCheckInTime ? '' : form.checkInTime,
    checkOutTime: form.checkOutTime === r.propertyCheckOutTime ? '' : form.checkOutTime,
    notes: form.notes.trim(),
  };
  if (value.guestName.length > GUEST_NAME_MAX)
    errors.guestName = `Keep the name to ${GUEST_NAME_MAX} characters`;
  if (value.guestEmail && !isEmail(value.guestEmail)) {
    errors.guestEmail = 'Enter an email address, such as name@example.com';
  }
  if (value.guestPhone && !isPhone(value.guestPhone)) {
    errors.guestPhone = 'Enter a phone number, such as +44 7700 900123';
  }
  if (value.checkInTime && !CLOCK.test(value.checkInTime)) errors.checkInTime = 'Enter a time, such as 15:00';
  if (value.checkOutTime && !CLOCK.test(value.checkOutTime))
    errors.checkOutTime = 'Enter a time, such as 10:00';
  if (value.notes.length > NOTES_MAX) {
    errors.notes = `Keep notes to ${NOTES_MAX.toLocaleString('en-GB')} characters`;
  }
  if (Object.keys(errors).length) return { update: null, errors };

  const update: ReservationUpdate = {};
  if (value.guestName !== before.guestName.trim()) update.guestName = value.guestName;
  if (value.guestEmail !== before.guestEmail) update.guestEmail = value.guestEmail;
  if (value.guestPhone !== before.guestPhone) update.guestPhone = value.guestPhone;
  if (value.checkInTime !== before.checkInTime) update.checkInTime = value.checkInTime || null;
  if (value.checkOutTime !== before.checkOutTime) update.checkOutTime = value.checkOutTime || null;
  if (value.notes !== before.notes) update.notes = value.notes;
  return { update: Object.keys(update).length ? update : null, errors };
}

// Reaching the guest ---------------------------------------------------------------------------

export interface ContactRoute {
  kind: 'email' | 'call' | 'text';
  label: string;
  /** What it uses, shown under the label: the address or the number. */
  detail: string;
  href: string;
}

/** Ways to reach the guest from this device: an email, a call, a text. */
export function contactRoutes(r: Reservation): ContactRoute[] {
  const routes: ContactRoute[] = [];
  if (r.guestEmail) {
    const subject = `Your stay at ${r.propertyName}, ${datesLabel(r.checkIn, r.checkOut)}`;
    routes.push({
      kind: 'email',
      label: 'Email',
      detail: r.guestEmail,
      href: `mailto:${r.guestEmail}?subject=${encodeURIComponent(subject)}`,
    });
  }
  if (r.guestPhone) {
    const number = r.guestPhone.replace(/[^\d+]/g, '');
    routes.push({ kind: 'call', label: 'Call', detail: r.guestPhone, href: `tel:${number}` });
    routes.push({ kind: 'text', label: 'Send a text', detail: r.guestPhone, href: `sms:${number}` });
  }
  return routes;
}

const CHANNEL_INBOX: Record<Channel, string | null> = {
  airbnb: 'Airbnb',
  booking_com: 'Booking.com',
  vrbo: 'Vrbo',
  expedia: 'Expedia',
  direct: null,
};

/** Where messages to the guest go until V-01's Inbox: the channel's own, for channel bookings. */
export function channelMessages(channel: Channel): string | null {
  const name = CHANNEL_INBOX[channel];
  return name ? `Messages with ${name} guests stay on ${name} until V-01's Inbox is ready.` : null;
}
