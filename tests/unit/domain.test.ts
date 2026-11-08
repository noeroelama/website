import { describe, expect, it } from "vitest";
import { isPubliclyVisible } from "@website/domain/content";
import { isRegistrationOpen } from "@website/domain/events";
import { money, orderTotal } from "@website/domain/shop";

const now = new Date("2026-10-07T00:00:00Z");
const past = new Date("2026-10-01T00:00:00Z");
const future = new Date("2026-12-01T00:00:00Z");

describe("domain rules", () => {
  it("scheduled content becomes visible at publishAt without a cron job", () => {
    expect(isPubliclyVisible({ status: "scheduled", publishAt: past, deletedAt: null }, now)).toBe(
      true,
    );
    expect(
      isPubliclyVisible({ status: "scheduled", publishAt: future, deletedAt: null }, now),
    ).toBe(false);
    expect(isPubliclyVisible({ status: "published", publishAt: null, deletedAt: now }, now)).toBe(
      false,
    );
  });

  it("registration closes at the deadline", () => {
    expect(
      isRegistrationOpen(
        { published: true, deletedAt: null, startsAt: future, registrationClosesAt: null },
        now,
      ),
    ).toBe(true);
    expect(
      isRegistrationOpen(
        { published: true, deletedAt: null, startsAt: future, registrationClosesAt: past },
        now,
      ),
    ).toBe(false);
  });

  it("money uses integer minor units and refuses currency mixing", () => {
    expect(
      orderTotal([{ productId: "p", quantity: 3, unitPrice: money(1500, "IDR") }], "IDR"),
    ).toEqual(money(4500, "IDR"));
    expect(() =>
      orderTotal([{ productId: "p", quantity: 1, unitPrice: money(1, "USD") }], "IDR"),
    ).toThrow(/mismatch/);
    expect(() => money(1.5, "USD")).toThrow();
  });
});
