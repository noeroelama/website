/**
 * Shop module (MySQL via @website/db). MUST stay self-contained (no imports from other domain modules)
 * so it can be extracted later without touching the rest.
 * Enforced by eslint (see eslint.config.mjs).
 */
export type CurrencyCode = string; // ISO 4217

/** Money is integer minor units. Never use floats for money. */
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

export type OrderStatus = "pending_payment" | "paid" | "fulfilled" | "cancelled" | "refunded";

export interface OrderLine {
  readonly productId: string;
  readonly quantity: number;
  readonly unitPrice: Money;
}

export function orderTotal(lines: readonly OrderLine[], currency: CurrencyCode): Money {
  return lines.reduce(
    (total, line) =>
      addMoney(total, money(line.unitPrice.amountMinor * line.quantity, line.unitPrice.currency)),
    money(0, currency),
  );
}

/** Hosted-checkout payment provider port. Card data never touches our servers. */
export interface PaymentProvider {
  createCheckoutSession(input: {
    orderId: string;
    lines: readonly OrderLine[];
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<{ checkoutUrl: string; providerSessionId: string }>;
  /** Verifies signature + timestamp; returns null when invalid. */
  verifyWebhook(
    rawBody: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<{ eventId: string; type: string } | null>;
}
