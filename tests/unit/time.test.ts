import { describe, expect, it } from "vitest";
import { utcToWallTime, wallTimeToUtc } from "@website/domain/shared";

describe("wall time in an IANA time zone ↔ UTC (event dates)", () => {
  it("converts a local date-time in the event's zone to UTC and back", () => {
    expect(wallTimeToUtc("2026-11-20T11:00", "Asia/Tokyo")).toEqual(
      new Date("2026-11-20T02:00:00.000Z"),
    );
    expect(utcToWallTime(new Date("2026-11-20T02:00:00.000Z"), "Asia/Tokyo")).toBe(
      "2026-11-20T11:00",
    );
    expect(wallTimeToUtc("2026-01-01T00:00", "UTC")).toEqual(new Date("2026-01-01T00:00:00Z"));
  });

  it("handles daylight saving time (Sydney, summer vs winter)", () => {
    expect(wallTimeToUtc("2026-01-15T09:00", "Australia/Sydney")).toEqual(
      new Date("2026-01-14T22:00:00.000Z"),
    );
    expect(wallTimeToUtc("2026-07-15T09:00", "Australia/Sydney")).toEqual(
      new Date("2026-07-14T23:00:00.000Z"),
    );
    expect(utcToWallTime(new Date("2026-01-14T22:00:00.000Z"), "Australia/Sydney")).toBe(
      "2026-01-15T09:00",
    );
  });

  it("returns null for an empty or invalid value", () => {
    expect(wallTimeToUtc("", "Asia/Tokyo")).toBeNull();
    expect(wallTimeToUtc("not a date", "Asia/Tokyo")).toBeNull();
  });
});
