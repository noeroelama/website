import { describe, expect, it } from "vitest";
import {
  canReceiveCampaigns,
  NewsletterEmailSchema,
  OPTIN_TTL_MS,
  optInDecision,
  confirmDecision,
} from "@website/domain/newsletter";

const now = new Date("2026-10-18T00:00:00Z");
const later = (ms: number) => new Date(now.getTime() + ms);

describe("newsletter double opt-in rules", () => {
  it("normalises and validates the address", () => {
    expect(NewsletterEmailSchema.parse("  Sari@Example.ORG ")).toBe("sari@example.org");
    for (const bad of ["", "sari", "sari@", "a@b", "<x>@example.org", `${"a".repeat(250)}@x.io`]) {
      expect(NewsletterEmailSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("starts an opt-in for new, unsubscribed or expired-pending addresses only", () => {
    expect(optInDecision(null, now)).toBe("start");
    expect(optInDecision({ status: "unsubscribed", tokenExpiresAt: null }, now)).toBe("start");
    expect(optInDecision({ status: "pending", tokenExpiresAt: now }, now)).toBe("start");
    expect(optInDecision({ status: "pending", tokenExpiresAt: null }, now)).toBe("start");
    expect(optInDecision({ status: "pending", tokenExpiresAt: later(OPTIN_TTL_MS) }, now)).toBe(
      "nothing",
    );
    expect(optInDecision({ status: "confirmed", tokenExpiresAt: null }, now)).toBe("nothing");
    expect(optInDecision({ status: "suppressed", tokenExpiresAt: null }, now)).toBe("nothing");
    expect(OPTIN_TTL_MS).toBe(48 * 60 * 60 * 1000);
  });

  it("confirms only a pending subscriber with the right, unexpired token", () => {
    const pending = { status: "pending" as const, tokenHash: "h", tokenExpiresAt: later(1000) };
    expect(confirmDecision(pending, "h", now)).toBe("confirmed");
    expect(confirmDecision(pending, "other", now)).toBe("invalid");
    expect(confirmDecision({ ...pending, tokenExpiresAt: now }, "h", now)).toBe("expired");
    expect(confirmDecision({ ...pending, tokenExpiresAt: null }, "h", now)).toBe("expired");
    expect(confirmDecision({ ...pending, status: "confirmed", tokenHash: null }, "h", now)).toBe(
      "invalid",
    );
    expect(confirmDecision(null, "h", now)).toBe("invalid");
  });
});

describe("who receives campaigns", () => {
  it("only confirmed, not deleted subscribers", () => {
    expect(canReceiveCampaigns({ status: "confirmed", deletedAt: null })).toBe(true);
    expect(canReceiveCampaigns({ status: "confirmed", deletedAt: now })).toBe(false);
    for (const status of ["pending", "unsubscribed", "suppressed"] as const) {
      expect(canReceiveCampaigns({ status, deletedAt: null })).toBe(false);
    }
  });
});
