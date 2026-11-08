import { createHash, randomBytes } from "node:crypto";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LETTERHEAD,
  type Letter,
  type LetterArchive,
  type LetterType,
  type UserSignature,
} from "@website/domain/documents";
import { normalizePermissions, type Principal, type Scope } from "@website/permissions";
import { encryptField } from "@website/security";
import { qrPng } from "@website/pdf";
import {
  ArchiveDamagedError,
  createLetterFileRoute,
  createLetterPdf,
  letterDesks,
  type LetterContext,
} from "../../apps/admin/src/server/letter-pdf";

const at = new Date("2026-11-02T03:00:00Z");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const type = {
  id: "sk",
  name: "Surat Keputusan",
  code: "SK",
  requiresCoordinator: true,
  requiresRecipient: false,
} as LetterType;
const letter: Letter = {
  id: "l1",
  version: 7,
  createdAt: at,
  updatedAt: at,
  deletedAt: null,
  periodId: "p1",
  typeId: "sk",
  orgUnitId: "sekjen",
  orgUnitPath: ["sekjen"],
  subject: "SK Panitia",
  body: "<p>Menetapkan panitia.</p>",
  recipient: "",
  place: "Tokyo",
  attachmentNote: "",
  letterDate: "2026-11-02",
  status: "issued",
  source: "editor",
  createdBy: "author",
  reviewedBy: "sekre",
  reviewNote: null,
  secretary: { uid: "sekjen", at },
  coordinator: { uid: "koor", at },
  number: 1,
  numberFormatted: "001/SK/PPIDK-ASIANIA/XI/2026",
  verificationCode: "8F3KM-QRTVW",
  issuedAt: at,
  cancelledAt: null,
  cancelReason: null,
  contentDigest: "x",
  signers: [
    {
      name: "Budi K",
      desk: "Koordinator PPIDK Asia-Oseania",
      position: null,
      period: "2026/2027",
      at,
    },
    {
      name: "Rina S",
      desk: "Sekretaris Jenderal PPIDK Asia-Oseania",
      position: "Sekjen",
      period: "2026/2027",
      at,
    },
  ],
  letterhead: DEFAULT_LETTERHEAD,
  archive: null,
  upload: null,
  placement: null,
  activityCode: null,
  sheetNumberTemplate: null,
};
const context: LetterContext = {
  type,
  unitName: "Sekretariat Jenderal",
  names: new Map([["sekjen", "Now Renamed"]]),
  letterhead: DEFAULT_LETTERHEAD,
};

let files: Map<string, Uint8Array>;
let recorded: LetterArchive | null;
let signatures: Map<string, UserSignature>;
let signatureKey: string | null;
const KEY = randomBytes(32).toString("base64");
let uuids = 0;
const deps = (
  verification: { host: string | null; webUrl: string | null } = {
    host: "verif.ppiasiania.id",
    webUrl: null,
  },
) => ({
  storage: {
    read: (path: string) => Promise.resolve(files.get(path) ?? null),
    save: vi.fn((path: string, bytes: Uint8Array) => {
      files.set(path, bytes);
      return Promise.resolve({ url: null });
    }),
  },
  letters: {
    setArchive: (_id: string, archive: LetterArchive) => {
      recorded ??= archive;
      return Promise.resolve(recorded);
    },
  },
  toPng: (bytes: Uint8Array) => Promise.resolve(bytes),
  verification,
  uuid: () => `abcd${String((uuids += 1)).padStart(4, "0")}-0000`,
  signatures: { get: (uid: string) => Promise.resolve(signatures.get(uid) ?? null) },
  signatureKey: () => signatureKey,
});

beforeEach(() => {
  files = new Map();
  recorded = null;
  uuids = 0;
  signatures = new Map();
  signatureKey = KEY;
});

const imageCount = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes)).context
    .enumerateIndirectObjects()
    .filter(
      ([, object]) =>
        object instanceof PDFRawStream &&
        object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
    ).length;

describe("letter desks as printed", () => {
  it("issued letters print the names frozen at issue; others the current names", () => {
    expect(letterDesks(letter, context)).toEqual([
      {
        label: "Koordinator PPIDK Asia-Oseania",
        name: "Budi K",
        signedOn: "2 November 2026",
        signature: null,
      },
      {
        label: "Sekretaris Jenderal PPIDK Asia-Oseania",
        name: "Rina S",
        signedOn: "2 November 2026",
        signature: null,
      },
    ]);
    const corrected = { ...letter, status: "corrected" as const, signers: [], coordinator: null };
    expect(letterDesks(corrected, context)).toEqual([
      { label: "Koordinator PPIDK Asia-Oseania", name: null, signedOn: null, signature: null },
      {
        label: "Sekretaris Jenderal PPIDK Asia-Oseania",
        name: "Now Renamed",
        signedOn: "2 November 2026",
        signature: null,
      },
    ]);
    const single = { ...context, type: { ...type, requiresCoordinator: false } };
    expect(letterDesks({ ...corrected, secretary: { uid: "unknown", at } }, single)).toEqual([
      { label: "Sekretariat Jenderal", name: null, signedOn: "2 November 2026", signature: null },
    ]);
  });
});

describe("personal signatures on letters (4.6)", () => {
  const store = async (uid: string, path: string, rotation = 0) => {
    files.set(path, new TextEncoder().encode(encryptField(await qrPng(uid, 120), KEY)));
    signatures.set(uid, { uid, path, type: "png", widthMm: 40, rotation, updatedAt: at });
  };

  it("letterDesks prints a signature only on a signed desk", () => {
    const image = {
      image: { bytes: new Uint8Array(), type: "png" as const },
      widthMm: 30,
      rotation: 5,
    };
    const pending = { ...letter, coordinator: null, signers: [] };
    const desks = letterDesks(
      pending,
      context,
      new Map([
        ["sekjen", image],
        ["koor", image],
      ]),
    );
    expect(desks.map((d) => d.signature)).toEqual([null, image]);
  });

  it("decrypts the signers' images; a missing key, record or broken file prints none", async () => {
    const pdf = createLetterPdf(deps());
    const without = await imageCount(await pdf.render(letter, context, null));
    await store("sekjen", "members/signatures/sekjen_1.enc", 12);
    await store("koor", "members/signatures/koor_1.enc");
    expect(await imageCount(await pdf.render(letter, context, null))).toBe(without + 2);
    files.set("members/signatures/koor_1.enc", new TextEncoder().encode("v1:broken"));
    expect(await imageCount(await pdf.render(letter, context, null))).toBe(without + 1);
    files.delete("members/signatures/sekjen_1.enc");
    expect(await imageCount(await pdf.render(letter, context, null))).toBe(without);
    await store("sekjen", "members/signatures/sekjen_2.enc");
    signatureKey = null;
    expect(await imageCount(await pdf.render(letter, context, null))).toBe(without);
  });
});

describe("upload path stamping (D3)", () => {
  it("stamps the signed desks' signatures and the QR where placed; refuses a changed file", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const original = await doc.save();
    files.set("letters/p1/l1_upload_a.pdf", original);
    const upload = {
      path: "letters/p1/l1_upload_a.pdf",
      sha256: sha(original),
      size: original.length,
      numberChecked: false,
      uploadedBy: "author",
      uploadedAt: at,
    };
    files.set(
      "members/signatures/sekjen_1.enc",
      new TextEncoder().encode(encryptField(await qrPng("s", 80), KEY)),
    );
    signatures.set("sekjen", {
      uid: "sekjen",
      path: "members/signatures/sekjen_1.enc",
      type: "png",
      widthMm: 40,
      rotation: 0,
      updatedAt: at,
    });
    const waiting: Letter = {
      ...letter,
      source: "upload",
      status: "awaiting_file",
      upload,
      archive: null,
    };
    const pdf = createLetterPdf(deps());
    expect(await pdf.stampUpload(waiting)).toEqual(original);
    const stamped = await pdf.stampUpload({
      ...waiting,
      placement: {
        qr: { page: 1, xMm: 170, yMm: 250, sizeMm: 22 },
        secretary: { page: 1, xMm: 130, yMm: 230 },
        coordinator: { page: 1, xMm: 30, yMm: 230 },
      },
    });
    expect(await imageCount(stamped)).toBe(2);
    files.set(upload.path, new Uint8Array([1]));
    await expect(pdf.stampUpload(waiting)).rejects.toThrow("missing or changed");
    await expect(pdf.stampUpload({ ...waiting, upload: null })).rejects.toThrow(
      "missing or changed",
    );
    const saved = await pdf.saveFile(waiting, stamped);
    expect(files.get(saved.path)).toBe(stamped);
    expect(saved).toEqual({ path: saved.path, sha256: sha(stamped), size: stamped.length });
  });
});

describe("letter archive (byte for byte)", () => {
  it("renders once, stores privately, records sha256; later reads check it", async () => {
    const pdf = createLetterPdf(deps());
    const first = await pdf.archive(letter, context, "2026/2027");
    expect(new TextDecoder().decode(first.slice(0, 5))).toBe("%PDF-");
    expect(recorded).toEqual({
      path: "letters/p1/l1_abcd0001.pdf",
      sha256: sha(first),
      size: first.length,
    });
    const again = await pdf.archive({ ...letter, archive: recorded }, context, "2026/2027");
    expect(again).toEqual(first);
    files.set("letters/p1/l1_abcd0001.pdf", new Uint8Array([1, 2, 3]));
    await expect(
      pdf.archive({ ...letter, archive: recorded }, context, null),
    ).rejects.toBeInstanceOf(ArchiveDamagedError);
    await expect(
      pdf.archive(
        { ...letter, archive: { ...(recorded as LetterArchive), path: "gone" } },
        context,
        null,
      ),
    ).rejects.toThrow("missing or changed");
  });

  it("a concurrent first archive wins and is served", async () => {
    const winner = await createLetterPdf(deps()).archive(letter, context, null);
    const pdf = createLetterPdf(deps());
    const late = await pdf.archive({ ...letter }, context, null);
    expect(late).toEqual(winner);
  });

  it("drafts render without number and QR; issued letters need a verification address", async () => {
    const pdf = createLetterPdf(deps({ host: null, webUrl: null }));
    const draft = {
      ...letter,
      status: "draft" as const,
      numberFormatted: null,
      verificationCode: null,
      letterhead: null,
      letterDate: null,
    };
    expect((await pdf.render(draft, context, null)).length).toBeGreaterThan(1000);
    await expect(pdf.render(letter, context, null)).rejects.toThrow(
      "Set VERIFICATION_HOST or WEB_URL",
    );
    const web = createLetterPdf(deps({ host: null, webUrl: "https://ppiasiania.id/" }));
    const cancelled = { ...letter, status: "cancelled" as const, cancelReason: null };
    expect((await web.render(cancelled, context, null)).length).toBeGreaterThan(1000);
  });

  it("letterhead images are read from Storage; a lost one falls back to text", async () => {
    files.set("letters/letterhead/a.webp", await qrPng("art", 100));
    const art = {
      path: "letters/letterhead/a.webp",
      url: "https://x.test/a",
      width: 100,
      height: 100,
    };
    const missing = { ...art, path: "letters/letterhead/gone.webp" };
    const pdf = createLetterPdf(deps());
    const bytes = await pdf.render(
      {
        ...letter,
        letterhead: {
          ...DEFAULT_LETTERHEAD,
          header: art,
          footer: missing,
          emblem: art,
          watermark: art,
        },
      },
      context,
      null,
    );
    expect(bytes.length).toBeGreaterThan(1000);
  });
});

describe("GET /api/letters/<id>/pdf", () => {
  const staff = (
    permissions: string[],
    scope: Scope = { type: "global" },
    active = true,
  ): Principal => ({
    kind: "user",
    userId: "s",
    active,
    assignments: [{ roleId: "r", scope, permissions: new Set(normalizePermissions(permissions)) }],
  });
  const route = (stored: Letter | null, options: { context?: boolean; fail?: boolean } = {}) => {
    const logError = vi.fn();
    const pdf = {
      render: vi.fn(() =>
        options.fail
          ? Promise.reject(new Error("boom"))
          : Promise.resolve(new Uint8Array([37, 80, 68, 70, 45])),
      ),
      archive: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70, 45, 49]))),
      stampUpload: vi.fn(() => Promise.resolve(new Uint8Array([37, 80, 68, 70, 45, 50]))),
    };
    const handler = createLetterFileRoute({
      getLetter: () => Promise.resolve(stored),
      load: () => Promise.resolve(options.context === false ? null : { context, period: null }),
      pdf,
      logError,
    });
    return { handler, pdf, logError };
  };

  it("serves the archive of issued letters and renders the others, inline and private", async () => {
    const { handler, pdf } = route(letter);
    const response = await handler("l1", staff(["letters.read"]));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(
      'inline; filename="001-SK-PPIDK-ASIANIA-XI-2026.pdf"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(pdf.archive).toHaveBeenCalled();
    const draft = route({ ...letter, status: "draft", numberFormatted: null, subject: "///" });
    const drafted = await draft.handler("l1", staff(["letters.read"]));
    expect(drafted.headers.get("content-disposition")).toBe('inline; filename="-.pdf"');
    expect(draft.pdf.render).toHaveBeenCalled();
    const empty = route({ ...letter, status: "draft", numberFormatted: null, subject: "" });
    expect(
      (await empty.handler("l1", staff(["letters.read"]))).headers.get("content-disposition"),
    ).toBe('inline; filename="letter.pdf"');
    const file = {
      path: "p",
      sha256: "s",
      size: 1,
      numberChecked: true,
      uploadedBy: "a",
      uploadedAt: at,
    };
    const waiting = route({ ...letter, status: "awaiting_file", source: "upload", upload: file });
    expect((await waiting.handler("l1", staff(["letters.read"]))).status).toBe(200);
    expect(waiting.pdf.stampUpload).toHaveBeenCalled();
    const batchLetter = route({ ...letter, source: "certificate" });
    expect((await batchLetter.handler("l1", staff(["letters.read"]))).status).toBe(404);
    const before = route({ ...letter, status: "awaiting_file", source: "upload" });
    expect((await before.handler("l1", staff(["letters.read"]))).status).toBe(404);
  });

  it("refuses strangers, hides letters out of scope, and never leaks errors", async () => {
    expect((await route(letter).handler("l1", null)).status).toBe(401);
    expect(
      (await route(letter).handler("l1", staff(["letters.read"], { type: "global" }, false)))
        .status,
    ).toBe(401);
    expect((await route(letter).handler("l1", staff([]))).status).toBe(403);
    expect((await route(letter).handler("l1", staff(["events.read"]))).status).toBe(404);
    expect(
      (
        await route(letter).handler(
          "l1",
          staff(["letters.read"], { type: "orgUnit", orgUnitId: "media" }),
        )
      ).status,
    ).toBe(404);
    expect((await route(null).handler("l1", staff(["letters.read"]))).status).toBe(404);
    expect(
      (await route({ ...letter, deletedAt: at }).handler("l1", staff(["letters.read"]))).status,
    ).toBe(404);
    expect(
      (await route(letter, { context: false }).handler("l1", staff(["letters.read"]))).status,
    ).toBe(404);
    const failing = route({ ...letter, status: "draft" }, { fail: true });
    const response = await failing.handler("l1", staff(["letters.read"]));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "internal", message: "Something went wrong." });
    expect(failing.logError).toHaveBeenCalledWith("letter pdf failed", {
      letterId: "l1",
      error: "Error: boom",
    });
  });
});
