import { formatMoney, minorDigits } from '@v01/shared';

/** "£120", or "£120.50" when there are pennies. */
export function moneyText(minor: number, currency: string, locale: string): string {
  return formatMoney({ amountMinor: minor, currency }, locale).replace(/\.00$/, '');
}

/** What goes back into a price box when editing: "120" or "120.50". */
export function minorToInput(minor: number | null | undefined, currency: string): string {
  if (!minor) return '';
  const digits = minorDigits(currency);
  const major = minor / 10 ** digits;
  return Number.isInteger(major) ? String(major) : major.toFixed(digits);
}

/** "£" for GBP in en-GB, shown inside price boxes. */
export function currencySymbol(currency: string, locale: string): string {
  return (
    new Intl.NumberFormat(locale, { style: 'currency', currency })
      .formatToParts(0)
      .find((part) => part.type === 'currency')?.value ?? currency
  );
}

/** 1st, 2nd, 3rd, 4th… */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}
