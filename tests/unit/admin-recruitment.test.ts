import { describe, expect, it } from "vitest";
import type { Recruitment } from "@website/domain/recruitment";
import {
  toRecruitmentItem,
  unitDrafts,
  unitsInput,
} from "../../apps/admin/src/components/recruitment-model";

const r: Recruitment = {
  id: "rec1",
  periodId: "p1",
  title: "Oprec 2026",
  description: "",
  opensAt: new Date("2026-11-01T00:00:00Z"),
  closesAt: new Date("2026-11-20T00:00:00Z"),
  maxChoices: 2,
  units: [{ orgUnitId: "media", name: "Media", quota: 2, portfolioRequired: true }],
  offerDays: 3,
  formId: "f1",
  formVersion: 2,
  published: true,
  version: 3,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-02T00:00:00Z"),
  deletedAt: null,
};

describe("Recruitment page model", () => {
  it("maps a recruitment with its seats and open state", () => {
    const item = toRecruitmentItem(
      r,
      "2026/2027",
      new Map([["media", { filled: 1 }]]),
      new Date("2026-11-05T00:00:00Z"),
    );
    expect(item).toMatchObject({
      periodName: "2026/2027",
      opensAt: "2026-11-01T00:00:00.000Z",
      open: true,
      units: [{ orgUnitId: "media", quota: 2, filled: 1, portfolioRequired: true }],
    });
    expect(toRecruitmentItem(r, "", new Map(), new Date("2026-12-01T00:00:00Z"))).toMatchObject({
      open: false,
      units: [{ filled: 0 }],
    });
  });

  it("lists every unit of the period, ticks the offered ones and sends only those", () => {
    const item = toRecruitmentItem(r, "", new Map([["media", { filled: 1 }]]), new Date());
    const drafts = unitDrafts(
      [
        { id: "koor", name: "Koordinator", path: [] },
        { id: "media", name: "Media", path: ["koor"] },
      ],
      item.units,
    );
    expect(drafts).toEqual([
      {
        orgUnitId: "koor",
        name: "Koordinator",
        depth: 0,
        offered: false,
        quota: "1",
        portfolioRequired: false,
        filled: 0,
      },
      {
        orgUnitId: "media",
        name: "Media",
        depth: 1,
        offered: true,
        quota: "2",
        portfolioRequired: true,
        filled: 1,
      },
    ]);
    expect(unitsInput(drafts)).toEqual([{ orgUnitId: "media", quota: 2, portfolioRequired: true }]);
  });
});
