import { describe, expect, it } from "vitest";
import type { PublicEvent } from "@website/domain/events";
import { eventQuery, eventsHref, pageOfEvents } from "../../apps/web/src/lib/event-query";

const event = (slug: string, start: string, extra: Partial<PublicEvent> = {}): PublicEvent => ({
  id: slug,
  slug,
  title: slug,
  type: "seminar",
  startsAt: new Date(start),
  timezone: "UTC",
  registrationClosesAt: null,
  location: null,
  chapterId: null,
  description: "",
  bannerImage: null,
  registrationUrl: null,
  schedule: [],
  speakers: [],
  sponsors: [],
  ...extra,
});

describe("public events list query (/events?type&from&to&page)", () => {
  it("accepts known types, ISO days and positive pages; ignores the rest", () => {
    expect(eventQuery({})).toEqual({ type: null, from: null, to: null, page: 1 });
    expect(
      eventQuery({ type: ["webinar"], from: "2026-01-01", to: "2026-12-31", page: "3" }),
    ).toEqual({ type: "webinar", from: "2026-01-01", to: "2026-12-31", page: 3 });
    expect(eventQuery({ type: "party", from: "1 Jan", to: "2026-1-1", page: "0" })).toEqual({
      type: null,
      from: null,
      to: null,
      page: 1,
    });
  });

  it("filters by type and an inclusive date range, then pages by 12", () => {
    const all = [
      event("a", "2026-10-01T00:00:00Z"),
      event("b", "2026-10-31T23:00:00Z", { type: "webinar" }),
      event("c", "2026-11-01T00:00:00Z"),
      ...Array.from({ length: 12 }, (_, i) => event(`x${i}`, "2027-01-01T00:00:00Z")),
    ];
    const october = { type: null, from: "2026-10-01", to: "2026-10-31", page: 1 };
    expect(pageOfEvents(all, october).items.map((e) => e.slug)).toEqual(["a", "b"]);
    expect(pageOfEvents(all, { ...october, type: "webinar" }).items.map((e) => e.slug)).toEqual([
      "b",
    ]);
    expect(pageOfEvents(all, { type: null, from: null, to: null, page: 5 })).toMatchObject({
      page: 2,
      pages: 2,
    });
  });

  it("builds links that keep the filters", () => {
    expect(eventsHref({ type: null, from: null, to: null, page: 1 }, 1)).toBe("/events");
    expect(eventsHref({ type: "webinar", from: "2026-01-01", to: "2026-02-01", page: 1 }, 2)).toBe(
      "/events?type=webinar&from=2026-01-01&to=2026-02-01&page=2",
    );
  });
});
