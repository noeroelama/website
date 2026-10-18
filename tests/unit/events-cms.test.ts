import { describe, expect, it } from "vitest";
import {
  EVENT_TYPES,
  EventInputSchema,
  isRegistrationOpen,
  randomEventSlug,
  sortedSponsors,
} from "@website/domain/events";

const image = {
  url: "https://storage.example/events/banners/a.webp",
  thumbUrl: "https://storage.example/events/banners/a_thumb.webp",
  path: "events/banners/a.webp",
  thumbPath: "events/banners/a_thumb.webp",
  width: 2400,
  height: 1200,
};
const valid = {
  title: "Simposium 2026",
  type: "seminar",
  startsAt: "2026-11-20T02:00:00.000Z",
  timezone: "Asia/Tokyo",
  registrationClosesAt: "2026-11-19T15:00:00.000Z",
  location: "Tokyo",
  description: "Simposium tahunan.",
  bannerImage: image,
  registrationUrl: "",
  slug: "",
  schedule: [{ time: "09:00", title: "Pembukaan", description: "" }],
  speakers: [{ name: "Dr. Sari", description: "Peneliti", photo: null }],
  sponsors: [
    { logo: image, caption: "Sponsor A" },
    { logo: null, caption: "Sponsor B" },
  ],
};

describe("event form (EVENT DASHBOARD)", () => {
  it("accepts a complete event; empty registration link becomes null", () => {
    const parsed = EventInputSchema.parse(valid);
    expect(parsed.registrationUrl).toBeNull();
    expect(parsed.startsAt).toEqual(new Date(valid.startsAt));
  });

  it("registration deadline must be on or before the event date", () => {
    expect(
      EventInputSchema.safeParse({ ...valid, registrationClosesAt: valid.startsAt }).success,
    ).toBe(true);
    const late = EventInputSchema.safeParse({
      ...valid,
      registrationClosesAt: "2026-11-21T00:00:00.000Z",
    });
    expect(late.success).toBe(false);
    expect(late.error?.issues[0]?.path).toEqual(["registrationClosesAt"]);
  });

  it("refuses unknown types, time zones, bad links, slugs and schedule times", () => {
    for (const bad of [
      { type: "party" },
      { timezone: "Mars/Olympus" },
      { registrationUrl: "javascript:alert(1)" },
      { slug: "Not A Slug" },
      { schedule: [{ time: "9am", title: "x", description: "" }] },
      { bannerImage: null },
      { title: "<script>x</script>" },
      { extra: true },
    ]) {
      expect(EventInputSchema.safeParse({ ...valid, ...bad }).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });

  it("has a fixed type list (labels live in the app)", () => {
    expect(EVENT_TYPES).toContain("webinar");
  });

  it("random slug when the URL is left empty", () => {
    expect(randomEventSlug("3f2a9c1e-0000-4000-8000-000000000000")).toBe("event-3f2a9c1e");
  });

  it("a deleted event never takes registrations", () => {
    const open = {
      published: true,
      deletedAt: null,
      startsAt: new Date("2026-12-01T00:00:00Z"),
      registrationClosesAt: null,
    };
    const now = new Date("2026-11-01T00:00:00Z");
    expect(isRegistrationOpen(open, now)).toBe(true);
    expect(isRegistrationOpen({ ...open, deletedAt: now }, now)).toBe(false);
  });

  it("sponsors are shown by their order number", () => {
    expect(
      sortedSponsors([
        { order: 2, logo: null, caption: "B" },
        { order: 1, logo: null, caption: "A" },
      ]).map((s) => s.caption),
    ).toEqual(["A", "B"]);
  });
});
