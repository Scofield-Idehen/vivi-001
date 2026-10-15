import { addDays, type NightOwnRules, nightRules, type UsualRules } from '@v01/shared';

export interface RestrictionRange {
  /** Inclusive at both ends, as channel managers expect. */
  dateFrom: string;
  dateTo: string;
  /** Left out when V-01 doesn't set the property's prices, or it has none yet. */
  rateMinor?: number;
  minStayArrival: number;
  /** Null: no longest stay. */
  maxStay: number | null;
  closedToArrival: boolean;
  closedToDeparture: boolean;
}

export interface RestrictionPlan {
  ranges: RestrictionRange[];
  /** Nights whose price was outside the property's limits, so the limit went instead. */
  heldAtLimit: number;
}

type Values = Omit<RestrictionRange, 'dateFrom' | 'dateTo'>;

function same(a: Values, b: Values): boolean {
  return (
    a.rateMinor === b.rateMinor &&
    a.minStayArrival === b.minStayArrival &&
    a.maxStay === b.maxStay &&
    a.closedToArrival === b.closedToArrival &&
    a.closedToDeparture === b.closedToDeparture
  );
}

/**
 * Prices and stay rules for one property across [dateFrom, dateTo], night by night from its usual
 * rules and the nights that have their own, merged into runs of equal values so a 500-night sync
 * is one call. The same nightRules() draws the calendar screen, so what the channels get is what
 * the team sees. Prices never leave the property's limits, and go only when V-01 sets them: a
 * property priced by PriceLabs keeps PriceLabs' prices.
 */
export function restrictionRanges(
  dateFrom: string,
  dateTo: string,
  usual: UsualRules,
  nights: (NightOwnRules & { night: string })[],
  options: { sendRates: boolean },
): RestrictionPlan {
  const own = new Map(nights.map((n) => [n.night, n]));
  const ranges: RestrictionRange[] = [];
  let heldAtLimit = 0;
  for (let night = dateFrom; night <= dateTo; night = addDays(night, 1)) {
    const rules = nightRules(usual, night, own.get(night));
    if (rules.heldAt) heldAtLimit += 1;
    const values: Values = {
      ...(options.sendRates && rules.priceMinor !== null ? { rateMinor: rules.priceMinor } : {}),
      minStayArrival: rules.minNights,
      maxStay: usual.maxNights,
      closedToArrival: rules.closedToArrival,
      closedToDeparture: rules.closedToDeparture,
    };
    const current = ranges.at(-1);
    if (current && same(current, values)) {
      current.dateTo = night;
    } else {
      ranges.push({ dateFrom: night, dateTo: night, ...values });
    }
  }
  return { ranges, heldAtLimit };
}
