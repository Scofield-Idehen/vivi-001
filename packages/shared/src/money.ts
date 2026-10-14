/**
 * Money is stored as whole minor units (pence, cents) plus a currency code.
 * Never use floating point for amounts.
 */
export interface Money {
  amountMinor: number;
  currency: string;
}

export function minorDigits(currency: string): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

/** Parses a decimal string such as "142.50" into minor units for the currency. */
export function parseMajorToMinor(value: string, currency: string): number {
  const digits = minorDigits(currency);
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error(`Not a decimal amount: "${value}"`);
  const [, sign, whole = '0', fraction = ''] = match;
  if (fraction.length > digits) {
    throw new Error(`${currency} allows ${digits} decimal places, got "${value}"`);
  }
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0');
  if (!Number.isSafeInteger(minor)) throw new Error(`Amount too large: "${value}"`);
  return sign ? -minor : minor;
}

/** Formats minor units as a decimal string, e.g. 14250 GBP -> "142.50". */
export function minorToMajorString(amountMinor: number, currency: string): string {
  if (!Number.isSafeInteger(amountMinor)) throw new Error('Amount must be a whole number of minor units');
  const digits = minorDigits(currency);
  const sign = amountMinor < 0 ? '-' : '';
  const abs = Math.abs(amountMinor)
    .toString()
    .padStart(digits + 1, '0');
  if (digits === 0) return `${sign}${abs}`;
  return `${sign}${abs.slice(0, -digits)}.${abs.slice(-digits)}`;
}

export function formatMoney(money: Money, locale = 'en-GB'): string {
  const digits = minorDigits(money.currency);
  return new Intl.NumberFormat(locale, { style: 'currency', currency: money.currency }).format(
    money.amountMinor / 10 ** digits,
  );
}
