import { describe, expect, it } from "vitest";
import {
  attachUpload,
  cancelLetter,
  checkUploadedNumber,
  issueUpload,
  letterUploadPath,
  placeStamps,
  UploadPlacementSchema,
  deskLabel,
  desksOf,
  isEditable,
  letterCanonical,
  LetterTypeInputSchema,
  makeVerificationCode,
  missingFields,
  normalizeLetterInput,
  normalizeVerificationCode,
  passReview,
  returnLetter,
  signDesk,
  submitForReview,
  type Letter,
  type LetterType,
} from "@website/domain/documents";

const now = new Date("2026-11-02T03:00:00Z");
const meta = { version: 1, createdAt: now, updatedAt: now, deletedAt: null };
const type = (extra: Partial<LetterType> = {}): LetterType => ({
  id: "und",
  ...meta,
  ...LetterTypeInputSchema.parse({
    name: "Surat Undangan",
    code: "SU",
    numberFormat: "{nomor}/{jenis}/{unit}/PPIDK-ASIANIA/{bulan_romawi}/{tahun}",
  }),
  ...extra,
});
const letter = (extra: Partial<Letter> = {}): Letter => ({
  id: "l1",
  ...meta,
  typeId: "und",
  orgUnitId: "sekjen",
  orgUnitPath: ["sekjen"],
  periodId: "p1",
  subject: "Undangan rapat",
  body: "<p>Isi</p>",
  recipient: "Ketua PPI Jepang",
  place: "Tokyo",
  attachmentNote: "",
  letterDate: "2026-11-02",
  status: "draft",
  source: "editor",
  createdBy: "author",
  reviewedBy: null,
  reviewNote: null,
  secretary: null,
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
  upload: null,
  placement: null,
  activityCode: null,
  sheetNumberTemplate: null,
  ...extra,
});

describe("letter types", () => {
  it("trims the code, checks the number pattern and keeps PPIDK defaults", () => {
    const parsed = LetterTypeInputSchema.parse({
      name: "Surat Permohonan",
      code: " SPm ",
      numberFormat: "{nomor}/{jenis}/{tahun}",
    });
    expect(parsed).toMatchObject({
      code: "SPm",
      numberPadding: 3,
      requiresRecipient: true,
      requiresCoordinator: false,
      contentPublic: true,
      active: true,
    });
    const bad = LetterTypeInputSchema.safeParse({
      name: "X",
      code: "X",
      numberFormat: "{nomor}/{year}",
    });
    expect(bad.success ? null : bad.error.issues[0]?.message).toBe("Unknown placeholder {year}.");
    expect(
      LetterTypeInputSchema.safeParse({ name: "X", code: "A B", numberFormat: "{nomor}" }).success,
    ).toBe(false);
  });
});

describe("letter workflow (draft → review → corrected → desks → approved)", () => {
  it("submits only complete drafts; a type without recipient clears it", () => {
    const sk = type({ requiresRecipient: false });
    expect(normalizeLetterInput(letter(), sk).recipient).toBe("");
    expect(normalizeLetterInput(letter(), type()).recipient).toBe("Ketua PPI Jepang");
    expect(missingFields(letter({ recipient: "" }), sk)).toEqual([]);
    expect(
      missingFields(letter({ subject: " ", body: "", letterDate: null, recipient: "" }), type()),
    ).toEqual(["Subject", "Body", "Letter date", "Recipient"]);
    expect(missingFields(letter({ body: "", source: "upload" }), type())).toEqual([]);
    expect(() => submitForReview(letter({ body: "" }), type())).toThrow("Complete first: Body.");
    expect(submitForReview(letter(), type()).status).toBe("review");
    expect(() => submitForReview(letter({ status: "review" }), type())).toThrow("Only drafts");
    expect(isEditable(letter())).toBe(true);
    expect(isEditable(letter({ status: "review" }))).toBe(true);
    expect(isEditable(letter({ status: "corrected" }))).toBe(false);
  });

  it("nobody signs before the secretariat passes it; one person never holds both desks", () => {
    const sk = type({ requiresCoordinator: true });
    expect(() => signDesk(letter({ status: "review" }), sk, "secretary", "sekjen", now)).toThrow(
      "The secretariat must pass",
    );
    const corrected = passReview(letter({ status: "review" }), sk, "sekre");
    expect(corrected).toMatchObject({ status: "corrected", reviewedBy: "sekre" });
    expect(() => passReview(letter(), sk, "sekre")).toThrow("Only letters under review");
    const one = signDesk(corrected, sk, "secretary", "sekjen", now);
    expect(one).toMatchObject({ status: "corrected", secretary: { uid: "sekjen", at: now } });
    expect(() => signDesk(one, sk, "secretary", "x", now)).toThrow("already signed");
    expect(() => signDesk(one, sk, "coordinator", "sekjen", now)).toThrow("both signing desks");
    const both = signDesk(one, sk, "coordinator", "koor", now);
    expect(both.status).toBe("approved");
    expect(desksOf(type())).toEqual(["secretary"]);
    expect(() => signDesk(corrected, type(), "coordinator", "koor", now)).toThrow(
      "no Coordinator desk",
    );
    expect(signDesk({ ...corrected }, type(), "secretary", "sekjen", now).status).toBe("approved");
    const reversed = signDesk(
      signDesk(corrected, sk, "coordinator", "koor", now),
      sk,
      "secretary",
      "sekjen",
      now,
    );
    expect(reversed.status).toBe("approved");
    expect(() =>
      signDesk(signDesk(corrected, sk, "coordinator", "koor", now), sk, "secretary", "koor", now),
    ).toThrow("both signing desks");
  });

  it("returning clears both desks and needs a note", () => {
    const approved = letter({
      status: "approved",
      secretary: { uid: "s", at: now },
      coordinator: { uid: "c", at: now },
    });
    expect(returnLetter(approved, "sekre", " Fix the date ")).toMatchObject({
      status: "draft",
      reviewNote: "Fix the date",
      secretary: null,
      coordinator: null,
    });
    expect(() => returnLetter(approved, "sekre", " ")).toThrow("Say what must be fixed.");
    expect(() => returnLetter(letter({ status: "issued" }), "s", "x")).toThrow("Only letters in");
  });

  it("cancels only numbered letters, with a public reason; the number stays", () => {
    const issued = letter({ status: "issued", number: 4, numberFormatted: "004/SU" });
    expect(cancelLetter(issued, " wrong date ", now)).toMatchObject({
      status: "cancelled",
      number: 4,
      cancelReason: "wrong date",
      cancelledAt: now,
    });
    expect(cancelLetter(letter({ status: "awaiting_file" }), "x", now).status).toBe("cancelled");
    expect(() => cancelLetter(issued, "", now)).toThrow("Give the reason");
    expect(() => cancelLetter(letter(), "x", now)).toThrow("Only numbered letters");
  });

  it("desk labels as printed", () => {
    expect(deskLabel("coordinator", type(), null)).toBe("Koordinator PPIDK Asia-Oseania");
    expect(deskLabel("secretary", type({ requiresCoordinator: true }), "Media")).toBe(
      "Sekretaris Jenderal PPIDK Asia-Oseania",
    );
    expect(deskLabel("secretary", type(), "Direktorat Media")).toBe("Direktorat Media");
    expect(deskLabel("secretary", type(), null)).toBe("PPIDK Asia-Oseania");
  });
});

describe("content digest and verification codes", () => {
  it("canonical text ignores line-ending and edge-space noise but not content", () => {
    const issued = letter({ numberFormatted: "001/SU", secretary: { uid: "s", at: now } });
    const text = letterCanonical(issued, "SU");
    expect(text.split("\x1f")).toEqual([
      "number=001/SU",
      "date=2026-11-02",
      "type=SU",
      "subject=Undangan rapat",
      "recipient=Ketua PPI Jepang",
      "body=<p>Isi</p>",
      "secretary=s",
      "coordinator=",
    ]);
    expect(letterCanonical({ ...issued, body: "  <p>Isi</p>\r\n" }, "SU")).toBe(text);
    expect(letterCanonical({ ...issued, body: "<p>Isi!</p>" }, "SU")).not.toBe(text);
    expect(letterCanonical(letter({ letterDate: null }), "SU")).toContain("number=\x1fdate=\x1f");
  });

  it("codes use a readable alphabet in two groups of five", () => {
    let i = 0;
    const code = makeVerificationCode((n) => (i++ * 7) % n);
    expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(code).not.toMatch(/[ILO01]/);
    expect(makeVerificationCode(() => 0)).toBe("AAAAA-AAAAA");
    expect(normalizeVerificationCode(" 8f3km-qrtvw ")).toBe("8F3KM-QRTVW");
    for (const bad of ["8F3KMQRTVW", "8F3K1-QRTVW", "layanan", "8F3KM-QRTVWX"]) {
      expect(normalizeVerificationCode(bad), bad).toBeNull();
    }
  });
});

describe("upload path (D3)", () => {
  const NUMBER = "001/SOP/PPIDK-ASIANIA/2026";
  const file = {
    path: "letters/p1/l1_upload_x.pdf",
    sha256: "a".repeat(64),
    size: 10,
    numberChecked: true,
    uploadedBy: "author",
    uploadedAt: now,
  };
  const waiting = letter({ source: "upload", status: "awaiting_file", numberFormatted: NUMBER });

  it("the number must be in a PDF with text (spaces and case ignored); a scan is not checked", () => {
    const text = (n: string) => `Standar Operasional Prosedur Sekretariat. Nomor: ${n}`;
    expect(checkUploadedNumber(text("001 / sop / PPIDK-ASIANIA /\n2026"), NUMBER)).toBe(true);
    expect(() => checkUploadedNumber(text("002/SOP/PPIDK-ASIANIA/2026"), NUMBER)).toThrow(
      `Number ${NUMBER} is not in the file.`,
    );
    expect(checkUploadedNumber("  scanner v2  page 1 ", NUMBER)).toBe(false);
  });

  it("files and stamp positions only while waiting for the file; issue needs the stamped file", () => {
    expect(letterUploadPath(waiting, "abcd-ef01-9")).toBe("letters/p1/l1_upload_abcdef01.pdf");
    expect(() => attachUpload(letter({ status: "approved" }), file)).toThrow(
      "This letter is not waiting for its file.",
    );
    const placement = UploadPlacementSchema.parse({
      qr: { page: 1, xMm: 170, yMm: 250, sizeMm: 22 },
      secretary: null,
      coordinator: null,
    });
    expect(placeStamps(waiting, placement).placement).toEqual(placement);
    expect(() => placeStamps(letter({ status: "issued" }), placement)).toThrow("not waiting");
    expect(
      UploadPlacementSchema.safeParse({ ...placement, qr: { page: 0, xMm: 1, yMm: 1, sizeMm: 20 } })
        .success,
    ).toBe(false);

    const archive = { path: "letters/p1/l1_b.pdf", sha256: "b".repeat(64), size: 12 };
    expect(() => issueUpload(waiting, archive, file.sha256, now)).toThrow(
      "Upload the final PDF first.",
    );
    const uploaded = attachUpload(waiting, file);
    expect(() => issueUpload(uploaded, archive, "c".repeat(64), now)).toThrow(
      "The file changed meanwhile. Issue it again.",
    );
    expect(issueUpload(uploaded, archive, file.sha256, now)).toMatchObject({
      status: "issued",
      issuedAt: now,
      archive,
    });
    expect(missingFields(letter({ source: "upload", body: "" }), type())).toEqual([]);
  });
});
