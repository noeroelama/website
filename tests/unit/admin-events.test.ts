import { describe, expect, it } from "vitest";
import type { EventEntity } from "@website/domain/events";
import { matchesTab, toEventItem } from "../../apps/admin/src/components/events-model";

const now = new Date("2026-10-18T00:00:00Z");
const entity: EventEntity = {
  id: "e1",
  version: 1,
  slug: "s",
  title: "S",
  summary: null,
  startsAt: new Date("2026-11-01T00:00:00Z"),
  endsAt: null,
  timezone: "Asia/Tokyo",
  location: null,
  chapterId: null,
  published: true,
  capacity: null,
  registrationClosesAt: null,
  type: "webinar",
  description: "",
  bannerImage: null,
  registrationUrl: null,
  schedule: [],
  speakers: [],
  sponsors: [
    { order: 2, logo: null, caption: "B" },
    { order: 1, logo: null, caption: "A" },
  ],
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
};

describe("Event page rows (server mapping)", () => {
  it("maps labels, status and sponsor order", () => {
    const row = toEventItem(entity);
    expect(row).toMatchObject({ typeLabel: "Webinar", status: "published", location: "" });
    expect(row.sponsors.map((s) => s.caption)).toEqual(["A", "B"]);
    expect(toEventItem({ ...entity, published: false, location: "Tokyo" })).toMatchObject({
      status: "draft",
      location: "Tokyo",
    });
  });

  it("tabs: drafts, upcoming and past (published only)", () => {
    const row = toEventItem(entity);
    const draft = { ...row, status: "draft" as const };
    const iso = now.toISOString();
    expect(matchesTab(row, "all", iso)).toBe(true);
    expect(matchesTab(row, "upcoming", iso)).toBe(true);
    expect(matchesTab(row, "past", iso)).toBe(false);
    expect(matchesTab(draft, "drafts", iso)).toBe(true);
    expect(matchesTab(draft, "upcoming", iso)).toBe(false);
  });
});
