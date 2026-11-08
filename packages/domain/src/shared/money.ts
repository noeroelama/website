export type CurrencyCode = string;

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

const ZERO_DIGITS: ReadonlySet<string> = new Set(["JPY", "KRW", "VND"]);
export const minorDigits = (currency: CurrencyCode): number => (ZERO_DIGITS.has(currency) ? 0 : 2);

export const formatMoney = ({ amountMinor, currency }: Money): string => {
  const digits = minorDigits(currency);
  const number = new Intl.NumberFormat("en", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amountMinor / 10 ** digits);
  return `${currency} ${number}`;
};

export const majorText = (amountMinor: number, currency: CurrencyCode): string => {
  const digits = minorDigits(currency);
  return (amountMinor / 10 ** digits).toFixed(digits);
};

export function toMinor(text: string, currency: CurrencyCode): number | null {
  const digits = minorDigits(currency);
  const match = /^(\d{1,15})(?:\.(\d+))?$/.exec(text.trim().replace(/,/g, ""));
  const fraction = match?.[2] ?? "";
  if (!match || fraction.length > digits) return null;
  const minor = Number(match[1]) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}
