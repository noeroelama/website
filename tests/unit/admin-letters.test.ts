import { describe, expect, it } from "vitest";
import {
  LETTER_TABS,
  letterActions,
  matchesLetterTab,
  toLetterItem,
  type LetterItem,
} from "../../apps/admin/src/components/letters-model";
import type { Letter, LetterType } from "@website/domain/documents";

const at = new Date("2026-11-02T03:00:00Z");
const letter: Letter = {
  id: "l1",
  version: 3,
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
  periodId: "p1",
  typeId: "sk",
  orgUnitId: "sekjen",
  orgUnitPath: ["sekjen"],
  subject: "SK Panitia",
  body: "<p>x</p>",
  recipient: "",
  place: "Tokyo",
  attachmentNote: "",
  letterDate: "2026-11-02",
  status: "corrected",
  source: "editor",
  createdBy: "author",
  reviewedBy: "sekre",
  reviewNote: null,
  secretary: { uid: "sekjen", at },
  coordinator: null,
  number: null,
  numberFormatted: null,
  verificationCode: null,
  issuedAt: null,
  cancelledAt: null,
  cancelReason: null,
  contentDigest: null,
  signers: [],
  letterhead: null,
  archive: null,
};
const type = {
  name: "Surat Keputusan",
  code: "SK",
  requiresCoordinator: true,
  requiresRecipient: false,
} as LetterType;
const names = new Map([
  ["sekjen", "Rina"],
  ["author", "Ari"],
]);
const none = { review: false, sign: false, signCoordinator: false, issue: false, cancel: false };
const item = (extra: Partial<LetterItem> = {}) => ({
  ...toLetterItem(letter, type, "Sekretariat", names, false),
  ...extra,
});

describe("Letters page model", () => {
  it("maps a letter for the page (names, desks, labels)", () => {
    expect(item()).toMatchObject({
      typeName: "Surat Keputusan",
      typeCode: "SK",
      unitName: "Sekretariat",
      statusLabel: "Corrected (to sign)",
      authorName: "Ari",
      secretary: { uid: "sekjen", name: "Rina", at: at.toISOString() },
      coordinator: null,
      requiresCoordinator: true,
      requiresRecipient: false,
      issuedAt: null,
    });
    const unknown = toLetterItem(
      { ...letter, createdBy: "x", issuedAt: at, secretary: { uid: "y", at } },
      undefined,
      "",
      names,
      true,
    );
    expect(unknown).toMatchObject({
      typeName: "",
      typeCode: "",
      authorName: "x",
      secretary: { name: "y" },
      requiresCoordinator: false,
      requiresRecipient: true,
      issuedAt: at.toISOString(),
      canEdit: true,
    });
  });

  it("tabs group the statuses by desk", () => {
    expect(LETTER_TABS.map((t) => t.key)).toEqual([
      "all",
      "draft",
      "review",
      "corrected",
      "approved",
      "issued",
      "cancelled",
    ]);
    expect(matchesLetterTab({ status: "awaiting_file" }, "approved")).toBe(true);
    expect(matchesLetterTab({ status: "approved" }, "approved")).toBe(true);
    expect(matchesLetterTab({ status: "issued" }, "all")).toBe(true);
    expect(matchesLetterTab({ status: "issued" }, "draft")).toBe(false);
  });

  it("shows only the buttons the viewer's desks allow", () => {
    expect(letterActions(item(), { ...none, sign: true, signCoordinator: true }, "sekjen")).toEqual(
      [],
    );
    expect(letterActions(item(), { ...none, signCoordinator: true }, "koor")).toEqual([
      "signCoordinator",
    ]);
    expect(
      letterActions(
        item({ secretary: null, coordinator: { uid: "koor", name: "K", at: "" } }),
        { ...none, sign: true },
        "koor",
      ),
    ).toEqual([]);
    expect(letterActions(item({ secretary: null }), { ...none, sign: true }, "sekjen")).toEqual([
      "signSecretary",
    ]);
    expect(
      letterActions(
        item({ requiresCoordinator: false }),
        { ...none, signCoordinator: true },
        "koor",
      ),
    ).toEqual([]);
    expect(letterActions(item({ status: "draft", canEdit: true }), none, "author")).toEqual([
      "edit",
      "submit",
      "delete",
    ]);
    expect(
      letterActions(item({ status: "review", canEdit: true }), { ...none, review: true }, "s"),
    ).toEqual(["edit", "pass", "return"]);
    expect(
      letterActions(item({ status: "approved" }), { ...none, review: true, issue: true }, "s"),
    ).toEqual(["return", "issue"]);
    expect(letterActions(item({ status: "issued" }), { ...none, cancel: true }, "s")).toEqual([
      "cancel",
    ]);
    expect(
      letterActions(item({ status: "awaiting_file" }), { ...none, cancel: true }, "s"),
    ).toEqual(["cancel"]);
    expect(
      letterActions(
        item({ status: "cancelled" }),
        { review: true, sign: true, signCoordinator: true, issue: true, cancel: true },
        "s",
      ),
    ).toEqual([]);
  });
});
