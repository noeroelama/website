import { describe, expect, it } from "vitest";
import {
  CampaignInputSchema,
  canChangeCampaign,
  canReceiveCampaigns,
  isDue,
  maskEmail,
  sendState,
  unsubscribeLinkData,
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

describe("campaigns (CAMPAIGN COMPOSER, send / schedule)", () => {
  it("validates subject, body and segment", () => {
    const valid = { subject: "Edisi Oktober", body: "<p>Halo</p>", segment: "all" };
    expect(CampaignInputSchema.safeParse(valid).success).toBe(true);
    for (const bad of [
      { subject: "" },
      { segment: "vip" },
      { body: "x".repeat(200_001) },
      { x: 1 },
    ]) {
      expect(CampaignInputSchema.safeParse({ ...valid, ...bad }).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });

  it("send now starts sending; a future time schedules; only drafts and scheduled can be sent", () => {
    expect(sendState(null, now)).toEqual({ status: "sending", sendAt: now });
    expect(sendState(later(60_000), now)).toEqual({ status: "scheduled", sendAt: later(60_000) });
    expect(sendState(now, now)).toEqual({ status: "sending", sendAt: now });
    expect(canChangeCampaign("draft")).toBe(true);
    expect(canChangeCampaign("scheduled")).toBe(true);
    expect(canChangeCampaign("sending")).toBe(false);
    expect(canChangeCampaign("sent")).toBe(false);
  });

  it("a scheduled campaign is due once its time has come; a sending one always", () => {
    expect(isDue({ status: "scheduled", sendAt: now }, now)).toBe(true);
    expect(isDue({ status: "scheduled", sendAt: later(1) }, now)).toBe(false);
    expect(isDue({ status: "sending", sendAt: later(1) }, now)).toBe(true);
    expect(isDue({ status: "draft", sendAt: null }, now)).toBe(false);
    expect(isDue({ status: "sent", sendAt: now }, now)).toBe(false);
  });

  it("masks addresses for staff without newsletter.edit; builds the unsubscribe link data", () => {
    expect(maskEmail("sari.wulandari@example.org")).toBe("s***@example.org");
    expect(maskEmail("x")).toBe("***");
    expect(unsubscribeLinkData("abc")).toEqual({ a: "unsubscribe", s: "abc" });
  });
});

describe("Newsletter page rows (server mapping)", () => {
  it("masks addresses unless the viewer may edit the newsletter", async () => {
    const { toSubscriberItem, toCampaignItem } =
      await import("../../apps/admin/src/components/newsletter-model");
    const row = {
      id: "s1",
      email: "sari@example.org",
      status: "confirmed" as const,
      createdAt: now,
      confirmedAt: null,
    };
    expect(toSubscriberItem(row, false).email).toBe("s***@example.org");
    expect(toSubscriberItem(row, true)).toMatchObject({
      email: "sari@example.org",
      confirmedAt: null,
    });
    expect(
      toCampaignItem({
        id: "c1",
        version: 1,
        subject: "S",
        body: "",
        segment: "all",
        status: "draft",
        sendAt: null,
        cursor: null,
        sentCount: 0,
        sentAt: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    ).toMatchObject({ sendAt: null, sentAt: null, status: "draft" });
  });
});
