import { describe, expect, it } from "vitest";
import type { PublicEvent } from "@website/domain/events";
import { formatEventTimeRange } from "../../apps/web/src/lib/event-time";
import {
  albumQuery,
  type EventQuery,
  eventQuery,
  eventsHref,
  pageOfEvents,
} from "../../apps/web/src/lib/event-query";

const event = (slug: string, start: string, extra: Partial<PublicEvent> = {}): PublicEvent => ({
  id: slug,
  slug,
  title: slug,
  type: "seminar",
  startsAt: new Date(start),
  endsAt: null,
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

const off: EventQuery = {
  category: null,
  q: null,
  region: null,
  time: "custom",
  from: null,
  to: null,
  page: 1,
};

describe("public events list query (/events?category&q&region&time&from&to&page)", () => {
  it("accepts known categories, ISO days, time presets and positive pages; ignores the rest", () => {
    expect(eventQuery({})).toEqual({ ...off, time: "upcoming" });
    expect(
      eventQuery({
        category: "webinar",
        q: "  beasiswa ",
        region: "Indonesia",
        time: "year",
        from: "2026-01-01",
        to: "2026-12-31",
        page: "3",
      }),
    ).toEqual({
      category: "webinar",
      q: "beasiswa",
      region: "Indonesia",
      time: "year",
      from: "2026-01-01",
      to: "2026-12-31",
      page: 3,
    });
    expect(
      eventQuery({ category: "party", time: "decade", from: "1 Jan", to: "2026-1-1", page: "0" }),
    ).toEqual({
      ...off,
      time: "upcoming",
    });
  });

  it("preset windows keep the current year: week/month are clamped at Dec 31, year is the calendar year", () => {
    const all = [
      event("old", "2025-12-31T00:00:00Z"),
      event("jan", "2026-01-15T00:00:00Z"),
      event("dec1", "2026-12-01T00:00:00Z"),
      event("dec29", "2026-12-29T00:00:00Z"),
      event("dec31", "2026-12-31T00:00:00Z"),
      event("newYear", "2027-01-02T00:00:00Z"),
    ];
    const yearEnd = new Date("2026-12-28T00:00:00Z");
    const at = (range: "upcoming" | "week" | "month" | "year") =>
      pageOfEvents(all, { ...off, time: range }, yearEnd).items.map((e) => e.slug);

    expect(at("upcoming")).toEqual(["dec29", "dec31", "newYear"]);
    expect(at("week")).toEqual(["dec29", "dec31"]);
    expect(at("month")).toEqual(["dec29", "dec31"]);
    expect(at("year")).toEqual(["jan", "dec1", "dec29", "dec31"]);
  });

  it("mid-year the week and month windows behave as rolling ranges", () => {
    const all = [
      event("before", "2026-11-03T00:00:00Z"),
      event("mid", "2026-11-10T00:00:00Z"),
      event("monthEnd", "2026-11-28T00:00:00Z"),
      event("afterMonth", "2026-12-10T00:00:00Z"),
    ];
    const november = new Date("2026-11-04T00:00:00Z");
    const at = (range: "week" | "month" | "year") =>
      pageOfEvents(all, { ...off, time: range }, november).items.map((e) => e.slug);

    expect(at("week")).toEqual(["mid"]);
    expect(at("month")).toEqual(["mid", "monthEnd"]);
    expect(at("year")).toEqual(["before", "mid", "monthEnd", "afterMonth"]);
  });

  it("filters by category and an inclusive date range, then pages by 12", () => {
    const festival = event("f", "2026-10-15T00:00:00Z", { type: "festival" });
    const all = [
      event("a", "2026-10-01T00:00:00Z"),
      event("b", "2026-10-31T23:00:00Z", { type: "webinar" }),
      event("c", "2026-11-01T00:00:00Z"),
      festival,
      ...Array.from({ length: 12 }, (_, i) => event(`x${i}`, "2027-01-01T00:00:00Z")),
    ];
    const october = { ...off, from: "2026-10-01", to: "2026-10-31" };
    expect(pageOfEvents(all, october).items.map((e) => e.slug)).toEqual(["a", "b", "f"]);
    expect(pageOfEvents(all, { ...october, category: "webinar" }).items.map((e) => e.slug)).toEqual(
      ["b"],
    );
    expect(pageOfEvents(all, { ...october, category: "other" }).items.map((e) => e.slug)).toEqual([
      "f",
    ]);
    expect(pageOfEvents(all, { ...off, page: 5 })).toMatchObject({ page: 2, pages: 2 });
  });

  it("matches the text search and the region suffix", () => {
    const all = [
      event("s", "2026-11-01T00:00:00Z", { title: "Seminar Beasiswa" }),
      event("l", "2026-11-02T00:00:00Z", { location: "Jakarta, Indonesia" }),
      event("t", "2026-11-03T00:00:00Z", { location: "Singapore" }),
    ];
    const at = (patch: Partial<typeof off>) =>
      pageOfEvents(all, { ...off, ...patch }).items.map((e) => e.slug);

    expect(at({ q: "BEASISWA" })).toEqual(["s"]);
    expect(at({ region: "indonesia" })).toEqual(["l"]);
    expect(at({ q: "x" })).toEqual([]);
  });

  it("builds links that keep the filters", () => {
    expect(eventsHref({ ...off, time: "upcoming" }, 1)).toBe("/events");
    expect(eventsHref({ ...off, time: "week", q: "beasiswa" }, 2)).toBe(
      "/events?q=beasiswa&time=week&page=2",
    );
    expect(
      eventsHref(
        { ...off, time: "year", category: "webinar", from: "2026-01-01", to: "2026-12-31" },
        1,
      ),
    ).toBe("/events?category=webinar&time=year&from=2026-01-01&to=2026-12-31");
  });
});

describe("events list: local days and order", () => {
  it("uses the event's own calendar day and the organisation's today; soonest first", () => {
    const jakarta = { timezone: "Asia/Jakarta" };
    const all = [
      event("later", "2026-11-20T02:00:00Z", jakarta),
      event("tonight-utc", "2026-11-10T20:00:00Z", jakarta),
      event("ended-yesterday", "2026-11-09T12:00:00Z", jakarta),
    ];
    const morningInJakarta = new Date("2026-11-10T18:30:00Z");
    expect(
      pageOfEvents(all, { ...off, time: "upcoming" }, morningInJakarta).items.map((e) => e.slug),
    ).toEqual(["tonight-utc", "later"]);
  });
});

describe("gallery period", () => {
  it("an empty period (the 'any date range' option) filters nothing", () => {
    expect(albumQuery({ time: "", q: "kongres" }).time).toBeNull();
    expect(albumQuery({ time: "year" }).time).toBe("year");
  });
});

describe("event time on the event page", () => {
  it("names the time zone the times are shown in", () => {
    const start = new Date("2026-11-20T10:00:00Z");
    const end = new Date("2026-11-20T12:00:00Z");
    expect(formatEventTimeRange(start, end, "Asia/Tokyo")).toBe("7:00 PM - 9:00 PM (GMT+9)");
    expect(formatEventTimeRange(start, null, "Asia/Jakarta")).toBe("5:00 PM (GMT+7)");
  });
});
