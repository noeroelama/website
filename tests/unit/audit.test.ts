import { describe, expect, it } from "vitest";
import * as audit from "@website/audit";
import {
  buildRevertEvent,
  canonicalJson,
  diffSnapshots,
  onlyChangedFields,
  evaluateRevert,
  REVERT_WINDOW_MS,
  type AuditEvent,
} from "@website/audit";

const DAY = 24 * 60 * 60 * 1000;
const base: AuditEvent = {
  id: "a1",
  occurredAt: new Date("2026-10-01T00:00:00Z"),
  actor: { type: "staff", id: "s1" },
  action: "UPDATE",
  resourceType: "news",
  resourceId: "n1",
  operationId: "op1",
  before: { title: "Old", meta: { tags: ["a"] } },
  after: { title: "New", meta: { tags: ["a", "b"] } },
  versionBefore: 3,
  versionAfter: 4,
  revertible: true,
  revertOf: null,
  request: { requestId: "r1" },
  prevHash: null,
  hash: null,
};

describe("audit", () => {
  it("diffs nested objects", () => {
    expect(diffSnapshots(base.before, base.after).map((c) => c.path)).toEqual([
      "meta.tags",
      "title",
    ]);
  });

  it("allows revert inside the 14-day window when versions match", () => {
    const now = new Date(base.occurredAt.getTime() + 13 * DAY);
    expect(evaluateRevert({ event: base, existingRevert: null, currentVersion: 4, now })).toEqual({
      allowed: true,
    });
  });

  it("rejects revert after 14 days, on concurrent edits, twice, or for non-revertible events", () => {
    const late = new Date(base.occurredAt.getTime() + REVERT_WINDOW_MS + 1);
    const now = new Date(base.occurredAt.getTime() + DAY);
    expect(
      evaluateRevert({ event: base, existingRevert: null, currentVersion: 4, now: late }),
    ).toMatchObject({ reason: "window_expired" });
    expect(
      evaluateRevert({ event: base, existingRevert: null, currentVersion: 5, now }),
    ).toMatchObject({ reason: "version_conflict" });
    expect(
      evaluateRevert({ event: base, existingRevert: base, currentVersion: 4, now }),
    ).toMatchObject({ reason: "already_reverted" });
    expect(
      evaluateRevert({
        event: { ...base, revertible: false },
        existingRevert: null,
        currentVersion: 4,
        now,
      }),
    ).toMatchObject({
      reason: "not_revertible",
    });
  });

  it("a revert produces a NEW event and leaves the original untouched", () => {
    const original = structuredClone(base);
    const revert = buildRevertEvent({
      original: base,
      id: "a2",
      operationId: "op2",
      actor: { type: "staff", id: "s2" },
      request: { requestId: "r2" },
      now: new Date(),
      currentVersion: 4,
    });
    expect(revert).toMatchObject({
      id: "a2",
      revertOf: "a1",
      action: "REVERT",
      before: base.after,
      after: base.before,
      versionAfter: 5,
    });
    expect(base).toEqual(original);
  });

  it("stores only the top-level fields that changed (create: after only, delete: before only)", () => {
    expect(
      onlyChangedFields(
        { title: "Old", tags: ["a"], body: "same", meta: { x: 1 } },
        { title: "New", tags: ["a"], body: "same", meta: { x: 2 }, summary: "added" },
      ),
    ).toEqual({
      // A field that did not exist is recorded as null, so a revert can clear it again.
      before: { title: "Old", meta: { x: 1 }, summary: null },
      after: { title: "New", meta: { x: 2 }, summary: "added" },
    });
    expect(onlyChangedFields(null, { title: "A" })).toEqual({
      before: null,
      after: { title: "A" },
    });
    expect(onlyChangedFields({ title: "A" }, null)).toEqual({
      before: { title: "A" },
      after: null,
    });
  });

  it("canonical JSON is stable: sorted keys, dates as ISO strings, undefined dropped", () => {
    expect(
      canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: new Date(0) }, u: undefined }),
    ).toBe('{"a":{"c":"1970-01-01T00:00:00.000Z","d":[2,{"y":2,"z":1}]},"b":1}');
  });

  it("exposes no mutation/deletion API", () => {
    const names = Object.keys(audit).join(" ");
    expect(names).not.toMatch(/update|delete|remove|purge|edit/i);
  });
});
