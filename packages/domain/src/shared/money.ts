/**
 * Money (DEC-8): integer minor units + ISO 4217 code, shared by shop and finance. Never floats;
 * amounts of different currencies are never added (no conversion, PPIDK DECISIONS §27).
 */
export type CurrencyCode = string; // ISO 4217

export interface Money {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

export function money(amountMinor: number, currency: CurrencyCode): Money {
  if (!Number.isSafeInteger(amountMinor))
    throw new RangeError("amountMinor must be a safe integer");
  if (!/^[A-Z]{3}$/.test(currency)) throw new RangeError("currency must be ISO 4217");
  return { amountMinor, currency };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new RangeError("currency mismatch");
  return money(a.amountMinor + b.amountMinor, a.currency);
}

/**
 * ISO 4217 minor digits. Fixed here, not read from Intl: stored amounts must mean the same on
 * every runtime (CLDR gives IDR 0 cash digits; ISO and PPIDK's decimal(15,2) give 2).
 * shortcut: only the region's zero-digit currencies are listed, add others when they are used.
 */
const ZERO_DIGITS: ReadonlySet<string> = new Set(["JPY", "KRW", "VND"]);
export const minorDigits = (currency: CurrencyCode): number => (ZERO_DIGITS.has(currency) ? 0 : 2);

/** "IDR 1,500,000.00" (code, not symbol: ¥ is both JPY and CNY; plain space for CSV and PDF). */
export const formatMoney = ({ amountMinor, currency }: Money): string => {
  const digits = minorDigits(currency);
  const number = new Intl.NumberFormat("en", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountMinor / 10 ** digits);
  return `${currency} ${number}`;
};

/**
 * A typed amount ("1,500,000.50") in minor units, or null when it is not a plain non-negative
 * number with at most the currency's digits after the point.
 */
export function toMinor(text: string, currency: CurrencyCode): number | null {
  const digits = minorDigits(currency);
  const match = /^(\d{1,15})(?:\.(\d+))?$/.exec(text.trim().replace(/,/g, ""));
  const fraction = match?.[2] ?? "";
  if (!match || fraction.length > digits) return null;
  const minor = Number(match[1]) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}
