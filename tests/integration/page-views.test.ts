import { describe, expect, it } from "vitest";
import { createSqlPageViewStore, deleteExpired, SITE_PAGE } from "@website/db/sql";
import { pageViewReport } from "../../apps/admin/src/server/page-views";
import { pageViewHit } from "../../apps/web/src/server/page-views";
import { fakeDb } from "../support/fake-db";

type Db = Parameters<typeof createSqlPageViewStore>[0];
const now = new Date("2026-11-08T05:00:00Z");
const desktop = "Mozilla/5.0 (Windows NT 10.0) Chrome/130";
const phone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile Safari";
const headers = (ua: string, ip = "203.0.113.7") =>
  new Headers({ "user-agent": ua, "x-real-ip": ip });
const hit = (page: string, ua = desktop, ip?: string, referrer: unknown = null) =>
  pageViewHit({ page, referrer }, headers(ua, ip), "secret", now);

describe("page views: web hit", () => {
  it("keeps the path, hashes the visitor per day and reads the device and referrer host", () => {
    const a = hit("/news/abc", phone, undefined, "https://www.Google.com/search?q=x");
    expect(a).toMatchObject({
      page: "/news/abc",
      mobile: true,
      referrer: "www.google.com",
      at: now,
    });
    expect(a?.visitor).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(a)).not.toContain("203.0.113.7");
    expect(hit("/news/abc", phone)?.visitor).toBe(a?.visitor);
    expect(hit("/news/abc", phone, "198.51.100.1")?.visitor).not.toBe(a?.visitor);
    const tomorrow = pageViewHit(
      { page: "/", referrer: null },
      headers(phone),
      "secret",
      new Date("2026-11-09T05:00:00Z"),
    );
    expect(tomorrow?.visitor).not.toBe(a?.visitor);
    expect(hit("/", desktop)?.mobile).toBe(false);
  });

  it("ignores bots, bad paths and bad referrers", () => {
    expect(hit("/", "Googlebot/2.1")).toBeNull();
    expect(hit("/", "")).toBeNull();
    for (const page of ["news", "/a?b=1", "/<script>", `/${"a".repeat(200)}`, 5, null]) {
      expect(pageViewHit({ page, referrer: null }, headers(desktop), "s", now)).toBeNull();
    }
    expect(hit("/", desktop, undefined, "javascript:alert(1)")?.referrer).toBeNull();
    expect(hit("/", desktop, undefined, "not a url")?.referrer).toBeNull();
    expect(hit("/", desktop, undefined, 42)?.referrer).toBeNull();
    expect(hit("/anything-a-client-sends", desktop)).toBeNull();
    expect(hit("/account/profile", desktop)).toBeNull();
    expect(hit("/news/abc/extra/levels", desktop)?.page).toBe("/news/abc");
    expect(hit("/verify/8F3KM-QRTVW", desktop)?.page).toBe("/verify");
    expect(hit("/about", desktop)?.page).toBe("/about");
  });
});

describe("page views: store and super admin report", () => {
  it("counts every view, one visit per visitor per day, devices and referrers per page", async () => {
    const fake = fakeDb();
    const store = createSqlPageViewStore(fake.db as unknown as Db);
    const record = async (...args: Parameters<typeof hit>) => {
      const h = hit(...args);
      if (h) await store.record(h);
    };
    await record("/news/a", phone, "1.1.1.1", "https://t.co/x");
    await record("/news/a", phone, "1.1.1.1", "https://t.co/x");
    await record("/news/a", desktop, "2.2.2.2");
    await record("/events", desktop, "2.2.2.2", "https://instagram.com/p");

    const report = await pageViewReport(store, now, { range: "month", page: null });
    expect(report.pages).toEqual([
      expect.objectContaining({
        page: "/news/a",
        views: 3,
        visits: 2,
        mobile: 1,
        referrers: [{ host: "t.co", visits: 1 }],
      }),
      expect.objectContaining({ page: "/events", views: 1, visits: 1, mobile: 0 }),
    ]);
    expect(report.daily).toHaveLength(30);
    expect(report.daily.at(-1)).toEqual({ label: "2026-11-08", views: 4, visits: 2 });
    expect(report.monthly).toHaveLength(12);
    expect(report.monthly.at(-1)).toMatchObject({ label: "2026-11", views: 4, visits: 2 });
    expect(report.yearly.map((y) => y.label)).toEqual(["2022", "2023", "2024", "2025", "2026"]);
    expect(report.totals).toMatchObject({ today: 4, month: 4, year: 4 });

    const one = await pageViewReport(store, now, { range: "day", page: "/news/a" });
    expect(one.page).toBe("/news/a");
    expect(one.daily.at(-1)).toMatchObject({ views: 3, visits: 2 });
    expect(one.pages.map((p) => p.page)).toEqual(["/news/a", "/events"]);
    expect(SITE_PAGE).toBe("*");
  });

  it("forgets visit markers after two days (expire cron job)", async () => {
    const fake = fakeDb();
    const store = createSqlPageViewStore(fake.db as unknown as Db);
    const h = hit("/");
    if (h) await store.record(h);
    const markers = () => [...fake.docs.keys()].filter((k) => k.startsWith("pageViewVisits/"));
    expect(markers()).toHaveLength(2);
    await deleteExpired(fake.db as unknown as Db, new Date("2026-11-11T00:00:00Z"));
    expect(markers()).toHaveLength(0);
  });
});
