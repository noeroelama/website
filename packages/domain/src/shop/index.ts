/**
 * Shop module (MySQL via @website/db). MUST stay self-contained (no imports from other domain modules,
 * only the shared kernel's Money, DEC-8) so it can be extracted later without touching the rest.
 * Enforced by eslint (see eslint.config.mjs).
 */
// Money lives in the shared kernel (DEC-8); re-exported so the shop API is unchanged.
import { addMoney, money, type CurrencyCode, type Money } from "../shared/money";
export { addMoney, money, type CurrencyCode, type Money };

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
