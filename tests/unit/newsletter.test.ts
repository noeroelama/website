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
  canDeleteCampaign,
  isPublicCampaign,
  parseSubscriberCsv,
  readTrackingLink,
  recentRates,
  staffOptInDecision,
  subscriberStats,
  trackingLinkData,
  trackLinks,
  IMPORT_MAX_ROWS,
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
      name: "Sari Wulandari",
      chapterId: "jp",
    };
    expect(toSubscriberItem(row, false, "PPI Jepang")).toMatchObject({
      email: "s***@example.org",
      name: null, // a name is personal data too
      ppi: "PPI Jepang",
    });
    expect(toSubscriberItem(row, true, null)).toMatchObject({ name: "Sari Wulandari", ppi: null });
    expect(toSubscriberItem(row, true, null)).toMatchObject({
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
        openCount: 0,
        clickCount: 0,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    ).toMatchObject({ sendAt: null, sentAt: null, status: "draft", openRate: null, author: null });
    const sent = toCampaignItem(
      {
        id: "c2",
        version: 2,
        subject: "S",
        body: "",
        segment: "all",
        status: "sent",
        sendAt: now,
        cursor: null,
        sentCount: 200,
        sentAt: now,
        openCount: 161,
        clickCount: 23,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
      { name: "Nevyllo K.", email: "n@example.org", initials: "NK" },
    );
    expect(sent).toMatchObject({
      openRate: 0.805,
      clickRate: 0.115,
      author: { name: "Nevyllo K." },
    });
  });
});

describe("staff add / import (still double opt-in)", () => {
  const live = later(60_000);
  it("starts an opt-in for new, deleted or expired-pending addresses; never re-mails an unsubscribe", () => {
    expect(staffOptInDecision(null, now)).toBe("start");
    expect(
      staffOptInDecision({ status: "confirmed", tokenExpiresAt: null, deletedAt: now }, now),
    ).toBe("start");
    expect(
      staffOptInDecision({ status: "pending", tokenExpiresAt: now, deletedAt: null }, now),
    ).toBe("start");
    expect(
      staffOptInDecision({ status: "unsubscribed", tokenExpiresAt: null, deletedAt: null }, now),
    ).toBe("unsubscribed");
    expect(
      staffOptInDecision({ status: "pending", tokenExpiresAt: live, deletedAt: null }, now),
    ).toBe("exists");
    expect(
      staffOptInDecision({ status: "confirmed", tokenExpiresAt: null, deletedAt: null }, now),
    ).toBe("exists");
  });

  it("a deleted subscriber can sign up again on the website", () => {
    expect(optInDecision({ status: "confirmed", tokenExpiresAt: null, deletedAt: now }, now)).toBe(
      "start",
    );
  });

  it("reads email, name and ppi columns by header (quoted fields, any order, BOM)", () => {
    const csv =
      "\uFEFFname,EMAIL,ppi,status\r\n" +
      '"Sari, W.",Sari@Example.org,PPI Jepang,confirmed\r\n' +
      ",budi@example.org,,\n" +
      "Bad,not-an-email,,\n" +
      '"Quote ""Q""",q@example.org,,\n' +
      "Solo,solo@example.org\n\n";
    expect(parseSubscriberCsv(csv)).toEqual({
      ok: true,
      rows: [
        { email: "sari@example.org", name: "Sari, W.", ppi: "PPI Jepang" },
        { email: "budi@example.org", name: "", ppi: "" },
        { email: "q@example.org", name: 'Quote "Q"', ppi: "" },
        { email: "solo@example.org", name: "Solo", ppi: "" }, // missing trailing columns
      ],
      invalid: [4],
    });
  });

  it("needs only an email column; refuses a file without one or with too many rows", () => {
    expect(parseSubscriberCsv("name\nSari")).toEqual({
      ok: false,
      error: 'The file needs an "email" column.',
    });
    expect(parseSubscriberCsv("email\nsolo@example.org")).toEqual({
      ok: true,
      rows: [{ email: "solo@example.org", name: "", ppi: "" }],
      invalid: [],
    });
    const many = ["email", ...Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `u${i}@x.io`)];
    expect(parseSubscriberCsv(many.join("\n"))).toMatchObject({ ok: false });
  });
});

describe("open and click tracking", () => {
  const c = "c1";
  const s = "a".repeat(64);
  it("round-trips signed link data and refuses anything else", () => {
    expect(readTrackingLink(trackingLinkData("open", c, s))).toEqual({
      kind: "open",
      campaignId: c,
      subscriberId: s,
      url: null,
    });
    expect(readTrackingLink(trackingLinkData("click", c, s, "https://ppi.id/a?b=1"))).toEqual({
      kind: "click",
      campaignId: c,
      subscriberId: s,
      url: "https://ppi.id/a?b=1",
    });
    expect(readTrackingLink(null)).toBeNull();
    expect(readTrackingLink({ a: "unsubscribe", s })).toBeNull();
    expect(readTrackingLink({ a: "o", c: "../x", s })).toBeNull();
    expect(readTrackingLink({ a: "c", c, s, u: "javascript:alert(1)" })).toBeNull();
    expect(readTrackingLink({ a: "c", c, s })).toBeNull();
  });

  it("wraps every http(s) link of the sanitised body, decoding &amp;", () => {
    const html = '<p><a href="https://ppi.id/?a=1&amp;b=2">x</a> <a href="mailto:a@b.c">m</a></p>';
    expect(trackLinks(html, (url) => `https://web/c?u=${url}&z`)).toBe(
      '<p><a href="https://web/c?u=https://ppi.id/?a=1&amp;b=2&amp;z">x</a> <a href="mailto:a@b.c">m</a></p>',
    );
  });

  it("average open/click rate of the last 5 sent campaigns, with the change against the 5 before", () => {
    const sent = (day: number, sentCount: number, openCount: number, clickCount: number) => ({
      status: "sent" as const,
      sentAt: new Date(Date.UTC(2026, 8, day)),
      sentCount,
      openCount,
      clickCount,
    });
    const list = [
      ...[1, 2, 3, 4, 5].map((d) => sent(d, 100, 40, 10)),
      ...[6, 7, 8, 9, 10].map((d) => sent(d, 100, 50, 5)),
      { status: "draft" as const, sentAt: null, sentCount: 0, openCount: 0, clickCount: 0 },
      sent(11, 0, 0, 0),
    ];
    const last = recentRates(list);
    expect(last.open).toBeCloseTo(0.5);
    expect(last.click).toBeCloseTo(0.05);
    expect(last.openDelta).toBeCloseTo(0.1);
    expect(last.clickDelta).toBeCloseTo(-0.05);
    const few = recentRates(list.slice(5, 8));
    expect(few.open).toBeCloseTo(0.5);
    expect(few.click).toBeCloseTo(0.05);
    expect(few).toMatchObject({ openDelta: null, clickDelta: null });
    expect(recentRates([])).toEqual({ open: null, click: null, openDelta: null, clickDelta: null });
  });

  it("active subscribers and how many confirmed this month (UTC)", () => {
    const row = (
      status: "confirmed" | "pending",
      confirmedAt: Date | null,
      deletedAt: Date | null = null,
    ) => ({
      status,
      confirmedAt,
      deletedAt,
    });
    expect(
      subscriberStats(
        [
          row("confirmed", new Date("2026-10-01T00:00:00Z")),
          row("confirmed", new Date("2026-09-30T23:59:59Z")),
          row("confirmed", new Date("2026-10-02T00:00:00Z"), now),
          row("pending", null),
        ],
        now,
      ),
    ).toEqual({ active: 2, thisMonth: 1 });
  });

  it("a sending campaign cannot be deleted; only sent and sending ones are public", () => {
    expect(canDeleteCampaign("draft")).toBe(true);
    expect(canDeleteCampaign("scheduled")).toBe(true);
    expect(canDeleteCampaign("sent")).toBe(true);
    expect(canDeleteCampaign("sending")).toBe(false);
    expect(isPublicCampaign({ status: "sent", deletedAt: null })).toBe(true);
    expect(isPublicCampaign({ status: "sending", deletedAt: null })).toBe(true);
    expect(isPublicCampaign({ status: "sent", deletedAt: now })).toBe(false);
    expect(isPublicCampaign({ status: "draft", deletedAt: null })).toBe(false);
  });
});
