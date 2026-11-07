import { describe, expect, it } from "vitest";
import { REVERT_WINDOW_MS, type AuditEvent } from "@website/audit";
import { ADMIN_NAVIGATION } from "../../apps/admin/src/navigation";
import {
  AUDIT_TABS,
  auditCsv,
  daysLeft,
  matchesTab,
  parseRange,
  previousChanges,
  rangeStart,
  shortUtc,
  toAuditRow,
  wordDiff,
} from "../../apps/admin/src/components/audit-model";

const author = { name: "Nevyllo K.", email: "nk@example.org", initials: "NK" };
const at = new Date("2026-10-18T03:36:00Z");
const img = (n: number) => ({
  url: `https://cdn/${n}.webp`,
  thumbUrl: `https://cdn/${n}_thumb.webp`,
  path: `gallery/${n}.webp`,
  thumbPath: `gallery/${n}_thumb.webp`,
  width: 10,
  height: 10,
});

const entry: AuditEvent = {
  id: "8cHcylcPpkXO8jbJxgoP",
  occurredAt: at,
  actor: { type: "staff", id: "u1", email: "nk@example.org" },
  action: "UPDATE",
  module: "gallery",
  title: "Wisuda PPI Thailand 2026",
  resourceType: "album",
  resourceId: "Qm2ve9lLxyz",
  operationId: "op1",
  before: { eventTitle: "Wisuda Thailand 2026", images: [img(1), img(2), img(3)] },
  after: { eventTitle: "Wisuda PPI Thailand 2026", images: [img(1), img(3), img(4), img(5)] },
  versionBefore: 1,
  versionAfter: 2,
  revertible: true,
  revertOf: null,
  request: { requestId: "r1", ipHash: "secret-hash" },
  prevHash: null,
  hash: null,
};

describe("Audit Log rows (server mapping)", () => {
  it("maps labels, the record reference and the previous change time", () => {
    const row = toAuditRow(entry, author, { allowed: true }, new Date("2026-09-28T10:05:00Z"));
    expect(row).toMatchObject({
      id: entry.id,
      occurredAt: at.toISOString(),
      author,
      action: "UPDATE",
      actionLabel: "Updated",
      moduleLabel: "Gallery",
      title: "Wisuda PPI Thailand 2026",
      ref: "Qm2ve9lL",
      previousAt: "2026-09-28T10:05:00.000Z",
      revert: { allowed: true },
    });
  });

  it("shows text and photo changes with added and removed photos", () => {
    const [title, photos] = toAuditRow(entry, author, { allowed: true }, null).changes;
    expect(title).toMatchObject({
      label: "Event title",
      before: { kind: "text", text: "Wisuda Thailand 2026" },
      after: { kind: "text", text: "Wisuda PPI Thailand 2026" },
    });
    expect(photos?.label).toBe("Photos");
    expect(photos?.before).toEqual({
      kind: "images",
      images: [
        { key: "gallery/1.webp", thumbUrl: "https://cdn/1_thumb.webp", change: null },
        { key: "gallery/2.webp", thumbUrl: "https://cdn/2_thumb.webp", change: "removed" },
        { key: "gallery/3.webp", thumbUrl: "https://cdn/3_thumb.webp", change: null },
      ],
    });
    expect(photos?.after.kind === "images" && photos.after.images.map((i) => i.change)).toEqual([
      null,
      null,
      "added",
      "added",
    ]);
  });

  it("create / delete: the missing side is empty; other values are JSON", () => {
    const created = toAuditRow(
      { ...entry, action: "CREATE", before: null, after: { published: true, bannerImage: img(9) } },
      author,
      { allowed: true },
      null,
    );
    expect(created.changes).toEqual([
      {
        field: "bannerImage",
        label: "Banner image",
        before: { kind: "images", images: [] },
        after: {
          kind: "images",
          images: [
            { key: "gallery/9.webp", thumbUrl: "https://cdn/9_thumb.webp", change: "added" },
          ],
        },
      },
      {
        field: "published",
        label: "Published",
        before: { kind: "empty" },
        after: { kind: "text", text: "true" },
      },
    ]);
  });

  it("reasons for an irreversible entry are labels; raw JSON leaves out request metadata", () => {
    const row = toAuditRow(entry, author, { allowed: false, reason: "is_revert" }, null);
    expect(row.revert).toEqual({ allowed: false, reason: "A revert cannot be reverted" });
    expect(row.raw).toContain('"operationId": "op1"');
    expect(row.raw).not.toContain("secret-hash");
  });

  it("previous change of the same record, from the newest-first list", () => {
    const older = { ...entry, id: "old", occurredAt: new Date("2026-10-01T00:00:00Z") };
    const other = { ...entry, id: "other", resourceId: "zzz" };
    expect(previousChanges([entry, other, older])).toEqual(new Map([[entry.id, older.occurredAt]]));
  });
});

describe("Audit Log list (browser)", () => {
  const row = toAuditRow(entry, author, { allowed: true }, null);

  it("tabs follow the side panel: a new page gets a tab without touching the Audit Log", () => {
    const pages = ADMIN_NAVIGATION.filter(
      (e) => e.permission !== null && e.permission !== "audit.read",
    ).map((e) => e.label);
    expect(Object.values(AUDIT_TABS).map((t) => t.label)).toEqual(["All", ...pages]);
    expect(Object.values(AUDIT_TABS).map((t) => t.label)).not.toContain("Dashboard");
    expect(Object.values(AUDIT_TABS).map((t) => t.label)).not.toContain("Audit Log");
  });

  it("tabs group admin pages; Organizations includes periods, structure and appointments", () => {
    expect(matchesTab(row, "all")).toBe(true);
    expect(matchesTab(row, "gallery")).toBe(true);
    expect(matchesTab(row, "events")).toBe(false);
    expect(matchesTab({ ...row, module: "periods" }, "organizations")).toBe(true);
    expect(matchesTab({ ...row, module: "appointments" }, "organizations")).toBe(true);
    expect(matchesTab({ ...row, module: "universities" }, "organizations")).toBe(true);
    expect(matchesTab({ ...row, module: "letter_types" }, "letters")).toBe(true);
    expect(matchesTab({ ...row, module: "incoming" }, "letters")).toBe(true);
    expect(matchesTab({ ...row, module: "roles" }, "users")).toBe(true);
  });

  it("Before shows day and time (year only when it differs); After shows the time", () => {
    expect(shortUtc("2026-09-28T10:05:00Z", "2026-10-18T03:36:00Z")).toBe("28 Sep, 10:05");
    expect(shortUtc("2025-12-01T09:00:00Z", "2026-10-18T03:36:00Z")).toBe("1 Dec 2025, 09:00");
    expect(shortUtc("2026-10-18T14:32:00Z")).toBe("14:32");
  });

  it("days left in the 14-day revert window (rounded up, never below 0)", () => {
    expect(daysLeft(at.toISOString(), at.getTime() + 2 * 3_600_000)).toBe(14);
    expect(daysLeft(at.toISOString(), at.getTime() + 86_400_000 + 1)).toBe(13);
    expect(daysLeft(at.toISOString(), at.getTime() + REVERT_WINDOW_MS + 1)).toBe(0);
  });

  it("date range from the URL (default last 7 days, unknown → default)", () => {
    const now = new Date("2026-10-20T00:00:00Z");
    expect(parseRange(undefined)).toBe("7d");
    expect(parseRange("nope")).toBe("7d");
    expect(parseRange("30d")).toBe("30d");
    expect(rangeStart("1d", now)).toEqual(new Date("2026-10-19T00:00:00Z"));
    expect(rangeStart("all", now)).toBeUndefined();
  });

  it("word diff marks the words added to the new text", () => {
    expect(wordDiff("Wisuda Thailand 2026", "Wisuda PPI Thailand 2026")).toEqual([
      { text: "Wisuda ", added: false },
      { text: "PPI ", added: true },
      { text: "Thailand 2026", added: false },
    ]);
    expect(wordDiff("", "New")).toEqual([{ text: "New", added: true }]);
  });

  it("CSV: header + one quoted line per entry", () => {
    const [header, line] = auditCsv([row]);
    expect(header?.[0]).toBe('"Date (UTC)"');
    expect(line).toEqual([
      '"2026-10-18 03:36"',
      '"Nevyllo K."',
      '"nk@example.org"',
      '"Updated"',
      '"Gallery"',
      '"Wisuda PPI Thailand 2026"',
      '"Qm2ve9lLxyz"',
      '"8cHcylcPpkXO8jbJxgoP"',
      '"Event title; Photos"',
    ]);
  });
});
