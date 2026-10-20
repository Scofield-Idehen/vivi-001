import type { Reservation } from '@v01/shared';
import { describe, expect, it } from 'vitest';
import {
  channelMessages,
  contactRoutes,
  datesLabel,
  formFrom,
  partyLabel,
  stayTimes,
  toUpdate,
  whenLabel,
} from '../src/pages/reservations/model.ts';

const TODAY = '2026-10-15';

const reservation = (patch: Partial<Reservation> = {}): Reservation => ({
  id: crypto.randomUUID(),
  propertyId: crypto.randomUUID(),
  propertyName: 'Mill Street Flat',
  propertyCode: 'MSF',
  status: 'confirmed',
  channel: 'airbnb',
  channelReference: 'HMB6N3T9XE',
  checkIn: '2026-10-20',
  checkOut: '2026-10-22',
  guestName: 'Hannah Lee',
  guestEmail: null,
  guestPhone: '+44 7700 900123',
  adults: 2,
  children: 0,
  infants: 0,
  currency: 'GBP',
  totalMinor: 17_000,
  payoutMinor: null,
  propertyCheckInTime: '15:00',
  propertyCheckOutTime: '10:00',
  checkInTime: null,
  checkOutTime: null,
  notes: null,
  cancelledAt: null,
  cancellationReason: null,
  cancelledBy: null,
  charges: [],
  payments: [],
  chargesMinor: 0,
  paidMinor: 0,
  balanceMinor: 17_000,
  createdAt: '2026-09-28T10:12:00.000Z',
  updatedAt: '2026-09-28T10:12:00.000Z',
  today: TODAY,
  ...patch,
});

describe('a booking in words', () => {
  it('names the party', () => {
    expect(partyLabel({ adults: 1, children: 0, infants: 0 })).toBe('1 adult');
    expect(partyLabel({ adults: 2, children: 1, infants: 0 })).toBe('2 adults and 1 child');
    expect(partyLabel({ adults: 2, children: 2, infants: 1 })).toBe('2 adults, 2 children and 1 infant');
  });

  it('says where the stay is from today', () => {
    const at = (checkIn: string, checkOut: string) =>
      whenLabel({ status: 'confirmed', checkIn, checkOut }, TODAY);
    expect(at('2026-10-16', '2026-10-18')).toBe('Arrives tomorrow');
    expect(at('2026-10-20', '2026-10-22')).toBe('Arrives in 5 days');
    expect(at('2026-10-15', '2026-10-17')).toBe('Arrives today');
    expect(at('2026-10-13', '2026-10-17')).toBe('Staying now');
    expect(at('2026-10-12', '2026-10-15')).toBe('Leaves today');
    expect(at('2026-10-10', '2026-10-12')).toBe('Left Mon 12 Oct');
    expect(whenLabel({ status: 'cancelled', checkIn: '2026-10-20', checkOut: '2026-10-22' }, TODAY)).toBe(
      'Cancelled',
    );
    expect(datesLabel('2026-10-20', '2026-10-22')).toBe('Tue 20 Oct to Thu 22 Oct');
  });

  it('uses times agreed for the stay, or the property’s usual ones', () => {
    expect(stayTimes(reservation())).toEqual({
      checkIn: '15:00',
      checkOut: '10:00',
      checkInAgreed: false,
      checkOutAgreed: false,
    });
    expect(stayTimes(reservation({ checkInTime: '13:00' }))).toMatchObject({
      checkIn: '13:00',
      checkInAgreed: true,
    });
  });
});

describe('changing a booking', () => {
  const r = reservation({ checkOutTime: '12:00', notes: 'Late check-out agreed.' });

  it('sends only what changed', () => {
    const form = { ...formFrom(r), guestEmail: ' hannah@guest.example ', checkInTime: '13:00' };
    expect(toUpdate(form, r)).toEqual({
      update: { guestEmail: 'hannah@guest.example', checkInTime: '13:00' },
      errors: {},
    });
    // Nothing changed: nothing to send, and nothing wrong.
    expect(toUpdate(formFrom(r), r)).toEqual({ update: null, errors: {} });
  });

  it('clears a detail left empty, and puts a time back to the property’s', () => {
    const form = { ...formFrom(r), guestPhone: '', checkOutTime: '', notes: '  ' };
    expect(toUpdate(form, r).update).toEqual({ guestPhone: '', checkOutTime: null, notes: '' });
    // Typing the usual time is the same as leaving it empty.
    expect(toUpdate({ ...formFrom(r), checkOutTime: '10:00' }, r).update).toEqual({ checkOutTime: null });
  });

  it('says what is wrong before sending anything', () => {
    const { update, errors } = toUpdate(
      { ...formFrom(r), guestEmail: 'hannah at home', guestPhone: 'call me', checkInTime: '25:00' },
      r,
    );
    expect(update).toBeNull();
    expect(errors).toEqual({
      guestEmail: 'Enter an email address, such as name@example.com',
      guestPhone: 'Enter a phone number, such as +44 7700 900123',
      checkInTime: 'Enter a time, such as 15:00',
    });
  });
});

describe('reaching the guest', () => {
  it('offers an email with the stay as its subject, a call and a text', () => {
    const routes = contactRoutes(reservation({ guestEmail: 'hannah@guest.example' }));
    expect(routes.map((x) => x.kind)).toEqual(['email', 'call', 'text']);
    expect(routes[0]?.href).toBe(
      `mailto:hannah@guest.example?subject=${encodeURIComponent('Your stay at Mill Street Flat, Tue 20 Oct to Thu 22 Oct')}`,
    );
    expect(routes[1]?.href).toBe('tel:+447700900123');
    expect(routes[2]?.href).toBe('sms:+447700900123');
    expect(contactRoutes(reservation({ guestPhone: null }))).toEqual([]);
  });

  it('says what reaches a channel guest’s chat, and when', () => {
    expect(channelMessages('booking_com')).toBe(
      "What you write in the Inbox reaches the guest's Booking.com chat once it is connected through Channex; until then it waits there.",
    );
    expect(channelMessages('direct')).toBeNull();
  });
});
