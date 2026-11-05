import { describe, expect, it } from "vitest";
import type { UserSummary } from "@website/db";
import type { Letter } from "@website/domain/documents";
import type { Meeting } from "@website/domain/meetings";
import type { Program } from "@website/domain/programs";
import { normalizePermissions, type Principal, type Scope } from "@website/permissions";
import { createSearch } from "../../apps/admin/src/server/search";

const staff = (permissions: string[], scope: Scope = { type: "global" }): Principal => ({
  kind: "user",
  userId: "u",
  active: true,
  assignments: [{ roleId: "r", scope, permissions: new Set(normalizePermissions(permissions)) }],
});
const media = ["dirs", "media"];
const other = ["other"];
const letters = [
  { id: "l1", numberFormatted: "001/AG/XI/2026", subject: "Undangan rapat", orgUnitPath: media },
  { id: "l2", numberFormatted: null, subject: "Rapat lain", orgUnitPath: other },
] as unknown as Letter[];
const programs = [
  { id: "p1", name: "Webinar Riset", orgUnitPath: media },
  { id: "p2", name: "Webinar Lain", orgUnitPath: other },
] as unknown as Program[];
const meetings = [
  {
    id: "m1",
    title: "Rapat kerja",
    orgUnitPath: media,
    participantIds: [],
    cancelledAt: null,
  },
  { id: "m2", title: "Rapat rahasia", orgUnitPath: other, participantIds: [], cancelledAt: null },
] as unknown as Meeting[];
const people = [
  { uid: "a", name: "Rapat Putri", email: "rp@example.org", chapterId: "jp" },
  { uid: "b", name: "Rani", email: "rani@example.org", chapterId: "au" },
  { uid: "c", name: null, email: "ratna@example.org", chapterId: null },
  { uid: "ra-uid", name: null, email: null, chapterId: null },
] as unknown as UserSummary[];

let period: { id: string } | null = { id: "p" };
const asked: Array<[string, unknown]> = [];
const search = createSearch({
  activePeriod: () => Promise.resolve(period),
  letters: (_periodId, orgUnitIds) => {
    asked.push(["letters", orgUnitIds]);
    return Promise.resolve(
      letters.filter(
        (l) => orgUnitIds === "all" || l.orgUnitPath.some((u) => orgUnitIds.includes(u)),
      ),
    );
  },
  programs: () => Promise.resolve(programs),
  meetings: () => Promise.resolve(meetings),
  people: (text) =>
    Promise.resolve(
      people.filter((p) => (p.name ?? p.email ?? p.uid).toLowerCase().startsWith(text)),
    ),
});
const ids = async (principal: Principal, q: string) =>
  (await search(principal, q)).map((r) => `${r.group}:${r.label}`);

describe("global search (G4)", () => {
  it("finds menu pages and records by word prefix, everywhere for global staff", async () => {
    expect(
      await ids(
        staff(["letters.read", "programs.read", "meetings.read", "users.read", "calendar.read"]),
        "  RA",
      ),
    ).toEqual([
      "Letters:Undangan rapat",
      "Letters:Rapat lain",
      "Meetings:Rapat kerja",
      "Meetings:Rapat rahasia",
      "People:Rapat Putri",
      "People:Rani",
      "People:ratna@example.org",
      "People:ra-uid",
    ]);
    expect(await ids(staff(["letters.read"]), "001/ag")).toEqual(["Letters:Undangan rapat"]);
    expect(await search(staff(["letters.read"]), "001/ag")).toEqual([
      { group: "Letters", label: "Undangan rapat", sub: "001/AG/XI/2026", href: "/letters" },
    ]);
    expect(await ids(staff(["calendar.read"]), "cal")).toEqual(["Menu:Calendar"]);
    expect(await ids(staff(["programs.read"]), "webinar")).toEqual([
      "Programmes:Webinar Riset",
      "Programmes:Webinar Lain",
    ]);
  });

  it("returns nothing outside the viewer's scope", async () => {
    const unit = { type: "orgUnit", orgUnitId: "media" } as const;
    const scoped = staff(["letters.read", "programs.read", "meetings.read"], unit);
    expect(await ids(scoped, "ra")).toEqual(["Letters:Undangan rapat", "Meetings:Rapat kerja"]);
    expect(asked.at(-1)).toEqual(["letters", ["media"]]);
    expect(await ids(scoped, "webinar")).toEqual(["Programmes:Webinar Riset"]);
    // Chapter-scoped people readers see only their chapter's accounts.
    expect(await ids(staff(["users.read"], { type: "chapter", chapterId: "jp" }), "ra")).toEqual([
      "People:Rapat Putri",
    ]);
    // No read permission: no records, and no menu entry for the page.
    expect(await ids(staff(["events.read"]), "ra")).toEqual([]);
    expect(await ids(staff(["events.read"]), "le")).toEqual([]);
    expect(await ids(staff(["events.read"]), "das")).toEqual(["Menu:Dashboard"]);
    // Too short, or no active period: no records.
    expect(await ids(staff(["letters.read"]), "r")).toEqual([]);
    period = null;
    expect(await ids(staff(["letters.read", "programs.read", "meetings.read"]), "ra")).toEqual([]);
  });
});
