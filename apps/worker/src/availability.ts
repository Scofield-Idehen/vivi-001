import { addDays } from '@v01/shared';

/** A calendar hold, as nights [start, end): end is the check-out day. */
export interface Hold {
  start: string;
  end: string;
}

export interface AvailabilityRange {
  /** Inclusive at both ends, as channel managers expect. */
  dateFrom: string;
  dateTo: string;
  available: number;
}

/**
 * Availability for a single-unit property across [dateFrom, dateTo], merged into runs of
 * equal value so a 500-day full sync is a handful of ranges, sent in one call.
 * Availability is always calculated from holds (bookings and blocks), never typed in.
 */
export function availabilityRanges(dateFrom: string, dateTo: string, holds: Hold[]): AvailabilityRange[] {
  const ranges: AvailabilityRange[] = [];
  let current: AvailabilityRange | undefined;
  for (let day = dateFrom; day <= dateTo; day = addDays(day, 1)) {
    const available = holds.some((h) => h.start <= day && day < h.end) ? 0 : 1;
    if (current && current.available === available) {
      current.dateTo = day;
    } else {
      current = { dateFrom: day, dateTo: day, available };
      ranges.push(current);
    }
  }
  return ranges;
}
