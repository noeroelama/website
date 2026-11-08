import { describe, expect, it } from "vitest";
import { isPubliclyVisible } from "@website/domain/content";
import { isRegistrationOpen } from "@website/domain/events";
import { money, orderTotal } from "@website/domain/shop";
import { placeReportTo, type OrgUnit } from "@website/domain/organizations";

/** A minimal live target unit for `placeReportTo` (only its guard fields are read). */
const unit = (id: string, periodId = "p"): OrgUnit =>
  ({
    id,
    periodId,
    deletedAt: null,
    reportTo: null,
  }) as OrgUnit;

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

  it("validates a unit's reporting line (round 23)", () => {
    const period = { status: "active" as const };
    // No report: nothing to check.
    expect(() => placeReportTo("p", period, "a", null, null)).not.toThrow();
    // A live target of the same period is fine.
    expect(() => placeReportTo("p", period, "a", "b", unit("b"))).not.toThrow();
    // Missing period, archived period, self and dead/foreign targets are refused.
    expect(() => placeReportTo("p", null, "a", "b", unit("b"))).toThrow(/period first/);
    expect(() => placeReportTo("p", { status: "archived" }, "a", "b", unit("b"))).toThrow(
      /archived/,
    );
    expect(() => placeReportTo("p", period, "a", "a", unit("a"))).toThrow(/itself/);
    expect(() => placeReportTo("p", period, "a", "b", null)).toThrow(/does not exist/);
    expect(() =>
      placeReportTo("p", period, "a", "b", { ...unit("b"), deletedAt: new Date() }),
    ).toThrow(/does not exist/);
    expect(() => placeReportTo("p", period, "a", "b", unit("b", "other-period"))).toThrow(
      /does not exist/,
    );
  });
});
