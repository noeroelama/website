import { describe, expect, it } from "vitest";
import {
  assertOkrWritable,
  keyResultPercent,
  objectivePercent,
  removeKeyResult,
  upsertKeyResult,
  type Objective,
} from "@website/domain/programs";

const objective = (extra: Partial<Objective> = {}): Objective => ({
  id: "o1",
  periodId: "p1",
  orgUnitId: null,
  orgUnitPath: [],
  title: "Grow the network",
  description: "",
  sort: 0,
  keyResults: [],
  version: 1,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  deletedAt: null,
  ...extra,
});
const kr = { title: "Members", unit: "people", sort: 0, direction: "up" as const };

describe("key result achievement (E1)", () => {
  it("is the position between baseline and target, clamped to 0-100", () => {
    expect(keyResultPercent({ baseline: 12, target: 30, current: 21, direction: "up" })).toBe(50);
    expect(keyResultPercent({ baseline: 12, target: 30, current: 40, direction: "up" })).toBe(100);
    expect(keyResultPercent({ baseline: 12, target: 30, current: 5, direction: "up" })).toBe(0);
  });

  it("works the same way for a key result achieved by shrinking", () => {
    expect(keyResultPercent({ baseline: 30, target: 10, current: 20, direction: "down" })).toBe(50);
  });

  it("target = baseline means keep it: 100 unless it moved the wrong way", () => {
    expect(keyResultPercent({ baseline: 5, target: 5, current: 5, direction: "up" })).toBe(100);
    expect(keyResultPercent({ baseline: 5, target: 5, current: 4, direction: "up" })).toBe(0);
    expect(keyResultPercent({ baseline: 5, target: 5, current: 4, direction: "down" })).toBe(100);
    expect(keyResultPercent({ baseline: 5, target: 5, current: 6, direction: "down" })).toBe(0);
  });

  it("an objective is the plain average of its key results; none = 0", () => {
    expect(objectivePercent(objective())).toBe(0);
    const o = objective({
      keyResults: [
        { ...kr, id: "a", baseline: 0, target: 10, current: 10, measuredAt: null },
        { ...kr, id: "b", baseline: 0, target: 10, current: 5, measuredAt: null },
      ],
    });
    expect(objectivePercent(o)).toBe(75);
  });
});

describe("key result changes", () => {
  const now = new Date("2026-11-04T00:00:00Z");
  const later = new Date("2026-11-05T00:00:00Z");

  it("adds in sort order and moves measuredAt only when the value changes", () => {
    let o = upsertKeyResult(
      objective(),
      "b",
      { ...kr, sort: 2, baseline: 0, target: 9, current: 1 },
      now,
    );
    o = upsertKeyResult(o, "a", { ...kr, sort: 1, baseline: 0, target: 9, current: 0 }, now);
    expect(o.keyResults.map((k) => k.id)).toEqual(["a", "b"]);
    o = upsertKeyResult(
      o,
      "b",
      { ...kr, sort: 2, title: "Renamed", baseline: 0, target: 9, current: 1 },
      later,
    );
    expect(o.keyResults[1]).toMatchObject({ title: "Renamed", measuredAt: now });
    o = upsertKeyResult(o, "b", { ...kr, sort: 2, baseline: 0, target: 9, current: 3 }, later);
    expect(o.keyResults[1]?.measuredAt).toEqual(later);
    expect(removeKeyResult(o, "a").keyResults.map((k) => k.id)).toEqual(["b"]);
    expect(() => removeKeyResult(o, "zzz")).toThrow("does not exist");
  });

  it("refuses more than 20 key results", () => {
    let o = objective();
    for (let i = 0; i < 20; i += 1) {
      o = upsertKeyResult(o, `k${i}`, { ...kr, baseline: 0, target: 1, current: 0 }, now);
    }
    expect(() =>
      upsertKeyResult(o, "k21", { ...kr, baseline: 0, target: 1, current: 0 }, now),
    ).toThrow("At most 20");
  });

  it("archived or missing periods are read-only", () => {
    expect(() => assertOkrWritable(null)).toThrow("does not exist");
    expect(() => assertOkrWritable({ status: "active", deletedAt: new Date() })).toThrow(
      "does not exist",
    );
    expect(() => assertOkrWritable({ status: "archived", deletedAt: null })).toThrow("archived");
    expect(() => assertOkrWritable({ status: "draft", deletedAt: null })).not.toThrow();
  });
});
