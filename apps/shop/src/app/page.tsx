import { AppShell, StatusBadge } from "@website/ui";
import { money } from "@website/domain/shop";

// Fully prerendered at build. Per-customer parts (cart, account) go behind <Suspense>
// (docs/architecture.md#rendering).
export default function ShopHomePage() {
  const zero = money(0, "USD");
  return (
    <AppShell title="Shop">
      <p>
        <StatusBadge label="shop: ok" status="ok" />
      </p>
      <p>
        Cart total: {zero.amountMinor} {zero.currency}
      </p>
    </AppShell>
  );
}
