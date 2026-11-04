import { describe, expect, it } from "vitest";
import type { EventEntity } from "@website/domain/events";
import { authorsById, lastEditors } from "../../apps/admin/src/components/authors";
import {
  countdownLabel,
  eventsCsv,
  matchesTab,
  toEventItem,
} from "../../apps/admin/src/components/events-model";
import { formatInZone } from "../../apps/admin/src/components/format";

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
    const author = { name: "Nevyllo K.", email: "nk@example.org", initials: "NK" };
    const row = toEventItem(entity, author);
    expect(row).toMatchObject({
      typeLabel: "Webinar",
      status: "published",
      location: "",
      author,
    });
    expect(row.sponsors.map((s) => s.caption)).toEqual(["A", "B"]);
    expect(toEventItem({ ...entity, published: false, location: "Tokyo" }, null)).toMatchObject({
      status: "draft",
      location: "Tokyo",
      author: null,
    });
  });

  it("tabs: drafts, upcoming and past (published only)", () => {
    const row = toEventItem(entity, null);
    const draft = { ...row, status: "draft" as const };
    const iso = now.toISOString();
    expect(matchesTab(row, "all", iso)).toBe(true);
    expect(matchesTab(row, "upcoming", iso)).toBe(true);
    expect(matchesTab(row, "past", iso)).toBe(false);
    expect(matchesTab(draft, "drafts", iso)).toBe(true);
    expect(matchesTab(draft, "upcoming", iso)).toBe(false);
  });
});

describe("Event page list cells", () => {
  it("Last Modified: the author of an event's newest audited change, named from users/{uid}", () => {
    const actor = (id: string, email: string | null = `${id}@example.org`) => ({
      type: "staff" as const,
      id,
      email,
    });
    // Audit entries come newest first: the first entry per event wins; albums are ignored.
    const editors = lastEditors(
      [
        { resourceType: "event", resourceId: "e1", actor: actor("nk") },
        { resourceType: "album", resourceId: "e2", actor: actor("ana") },
        { resourceType: "event", resourceId: "e1", actor: actor("budi") },
        { resourceType: "event", resourceId: "e3", actor: actor("gone", null) },
      ],
      "event",
    );
    const users = new Map([["nk", { name: "Nevyllo Zamuel Kalangi", email: "nk@example.org" }]]);
    const authors = authorsById(editors, users);
    expect(authors.get("e1")).toEqual({
      name: "Nevyllo K.",
      email: "nk@example.org",
      initials: "NK",
    });
    expect(authors.has("e2")).toBe(false);
    // A user without a users/{uid} profile and without an e-mail has no author.
    expect(authors.has("e3")).toBe(false);
  });

  it("Event Date: date only on the event's clock, and 'In N days' while it is ahead", () => {
    expect(formatInZone("2026-11-14T02:00:00Z", "Asia/Shanghai", false)).toBe("14 Nov 2026");
    expect(formatInZone("2026-11-14T02:00:00Z", "UTC")).toBe("14 Nov 2026, 02:00");
    const today = Date.parse("2026-10-01T00:00:00Z");
    expect(countdownLabel("2026-11-14T00:00:00Z", today)).toBe("In 44 days");
    expect(countdownLabel("2026-10-01T12:00:00Z", today)).toBe("In 1 day");
    expect(countdownLabel("2026-09-30T00:00:00Z", today)).toBeNull();
    expect(countdownLabel("2026-10-01T00:00:00Z", today)).toBeNull();
  });
});

describe("Event page CSV export", () => {
  it("lists the shown events with quoted cells, in UTC", () => {
    const item = toEventItem(entity, {
      name: "Nevyllo K.",
      email: "nk@example.org",
      initials: "NK",
    });
    const [header, row] = eventsCsv([{ ...item, title: "=cmd", status: "draft" }]);
    expect(header?.[0]).toBe('"Title"');
    expect(row?.slice(0, 5)).toEqual([
      '"\'=cmd"',
      '"Webinar"',
      '"2026-11-01 00:00"',
      '""',
      '"Draft"',
    ]);
    expect(row?.at(-1)).toBe('"Nevyllo K."');
  });
});
