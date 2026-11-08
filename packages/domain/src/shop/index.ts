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

export interface PaymentProvider {
  createCheckoutSession(input: {
    orderId: string;
    lines: readonly OrderLine[];
    successUrl: string;
    cancelUrl: string;
    idempotencyKey: string;
  }): Promise<{ checkoutUrl: string; providerSessionId: string }>;
  verifyWebhook(
    rawBody: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<{ eventId: string; type: string } | null>;
}
