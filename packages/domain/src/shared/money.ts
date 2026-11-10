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

/**
 * Reads a typed amount as whole and fraction digits, accepting both "1,500.25" and "1.500,25".
 * With both separators the last one is the decimal mark; a separator used more than once groups
 * thousands; a single separator followed by exactly three digits groups thousands ("150.000",
 * "12,500"); any other single separator is the decimal mark ("12,50", "1.5"). Anything else
 * (letters, exponents, misplaced groups) is not an amount.
 */
function splitAmount(text: string): { whole: string; fraction: string } | null {
  const value = text.trim().replace(/\s/g, "");
  if (!/^\d[\d.,]*\d$|^\d$/.test(value)) return null;
  const hasDot = value.includes(".");
  const hasComma = value.includes(",");
  let decimal: "." | "," | null = null;
  if (hasDot && hasComma) {
    decimal = value.lastIndexOf(".") > value.lastIndexOf(",") ? "." : ",";
  } else if (hasDot || hasComma) {
    const mark = hasDot ? "." : ",";
    const once = value.indexOf(mark) === value.lastIndexOf(mark);
    if (once && !/^\d+[.,]\d{3}$/.test(value)) decimal = mark;
  }
  const [whole = "", fraction = ""] =
    decimal === null
      ? [value, ""]
      : [value.slice(0, value.lastIndexOf(decimal)), value.slice(value.lastIndexOf(decimal) + 1)];
  if (!/^\d*$/.test(fraction)) return null;
  if (/[.,]/.test(whole) && !/^\d{1,3}(?:([.,])\d{3})(?:\1\d{3})*$/.test(whole)) return null;
  return { whole: whole.replace(/[.,]/g, ""), fraction };
}

/** Reads a typed amount as minor units with the given number of decimals; null when it is not one. */
export function parseAmountMinor(text: string, digits: number): number | null {
  const parts = splitAmount(text);
  if (!parts || !/^\d{1,15}$/.test(parts.whole) || parts.fraction.length > digits) return null;
  const minor =
    Number(parts.whole) * 10 ** digits + Number(parts.fraction.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}

export const toMinor = (text: string, currency: CurrencyCode): number | null =>
  parseAmountMinor(text, minorDigits(currency));

/** Reads a machine decimal ("1234.5", as stored by MySQL) as minor units; never guesses. */
export function decimalToMinor(text: string, currency: CurrencyCode): number | null {
  const digits = minorDigits(currency);
  const match = /^(\d{1,15})(?:\.(\d+))?$/.exec(text.trim());
  const fraction = match?.[2] ?? "";
  if (!match || fraction.length > digits) return null;
  const minor = Number(match[1]) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}
