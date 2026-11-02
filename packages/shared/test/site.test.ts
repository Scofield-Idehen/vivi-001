import { describe, expect, it } from 'vitest';
import { type NightOwnRules, quoteStay, type SiteHomeRules } from '../src/index.ts';

const rules = (over: Partial<SiteHomeRules> = {}): SiteHomeRules => ({
  usual: {
    basePriceMinor: 10_000,
    weekendPriceMinor: 15_000,
    minPriceMinor: null,
    maxPriceMinor: null,
    minNights: 2,
    maxNights: null,
  },
  maxGuests: 4,
  maxNights: null,
  advanceNoticeHours: 0,
  checkInHour: 15,
  bookingWindowDays: 365,
  preparationDays: 0,
  cleaningFeeMinor: 5_000,
  extraGuestFeeMinor: null,
  extraGuestFrom: null,
  petsAllowed: false,
  childrenAllowed: true,
  ...over,
});
const party = { adults: 2, children: 0, infants: 0, pets: 0 };
// 2026-11-16 is a Monday.
const base = {
  own: new Map<string, NightOwnRules>(),
  taken: [] as { from: string; to: string }[],
  party,
  today: '2026-11-02',
  hourNow: 9,
  serviceFeeBp: null as number | null,
};

describe('quoteStay', () => {
  it('prices each night, weekends at the weekend price, plus cleaning', () => {
    const q = quoteStay({ ...base, rules: rules(), checkIn: '2026-11-19', checkOut: '2026-11-22' });
    // Thu 10,000 + Fri 15,000 + Sat 15,000 + cleaning 5,000
    expect(q).toMatchObject({
      ok: true,
      nights: 3,
      nightsMinor: 40_000,
      cleaningMinor: 5_000,
      totalMinor: 45_000,
    });
  });

  it('uses a night’s own price, extra guests and the service fee', () => {
    const own = new Map<string, NightOwnRules>([
      [
        '2026-11-16',
        { priceMinor: 20_000, minNights: null, closedToArrival: false, closedToDeparture: false },
      ],
    ]);
    const q = quoteStay({
      ...base,
      own,
      rules: rules({ extraGuestFeeMinor: 1_000, extraGuestFrom: 3 }),
      party: { ...party, adults: 4 },
      serviceFeeBp: 150,
      checkIn: '2026-11-16',
      checkOut: '2026-11-18',
    });
    // nights 20,000 + 10,000; 2 extra guests × 1,000 × 2 nights; cleaning 5,000; 1.5% of 39,000
    expect(q).toMatchObject({
      ok: true,
      nightsMinor: 30_000,
      extraGuestsMinor: 4_000,
      serviceMinor: 585,
      totalMinor: 39_585,
    });
  });

  it('refuses what the home’s rules don’t allow', () => {
    const at = (over: Partial<Parameters<typeof quoteStay>[0]>) =>
      quoteStay({ ...base, rules: rules(), checkIn: '2026-11-16', checkOut: '2026-11-18', ...over });
    expect(at({ checkOut: '2026-11-17' })).toMatchObject({ ok: false, reason: 'min_nights', minNights: 2 });
    expect(at({ party: { ...party, adults: 5 } })).toMatchObject({ reason: 'too_many_guests' });
    expect(at({ party: { ...party, pets: 1 } })).toMatchObject({ reason: 'no_pets' });
    expect(at({ checkIn: '2026-11-01', checkOut: '2026-11-03' })).toMatchObject({ reason: 'too_soon' });
    expect(
      at({ rules: rules({ advanceNoticeHours: 48 }), checkIn: '2026-11-03', checkOut: '2026-11-05' }),
    ).toMatchObject({
      reason: 'too_soon',
    });
    expect(
      at({ rules: rules({ advanceNoticeHours: 24 }), checkIn: '2026-11-03', checkOut: '2026-11-05' }),
    ).toMatchObject({
      ok: true,
    });
    expect(at({ taken: [{ from: '2026-11-17', to: '2026-11-20' }] })).toMatchObject({ reason: 'taken' });
    expect(at({ taken: [{ from: '2026-11-18', to: '2026-11-20' }] })).toMatchObject({ ok: true });
    expect(
      at({ rules: rules({ preparationDays: 1 }), taken: [{ from: '2026-11-18', to: '2026-11-20' }] }),
    ).toMatchObject({ reason: 'taken' });
    expect(
      at({ rules: rules({ usual: { ...rules().usual, basePriceMinor: null, weekendPriceMinor: null } }) }),
    ).toMatchObject({ reason: 'no_price' });
  });
});
