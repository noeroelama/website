import { describe, expect, it } from "vitest";
import { letterVerification, maskName, namesMatch, type Letter } from "@website/domain/documents";

const at = new Date("2026-11-02T03:00:00Z");
const letter = {
  id: "l1",
  status: "issued",
  numberFormatted: "001/SKet/SEKJEN/PPIDK-ASIANIA/XI/2026",
  subject: "Keterangan aktif",
  recipient: "Arif  Nurwahid",
  letterDate: "2026-11-02",
  body: "<p>Isi</p>",
  signers: [
    {
      name: "Rina",
      desk: "Sekretaris Jenderal PPIDK Asia-Oseania",
      position: "Sekjen",
      period: "2026/2027",
      at,
    },
  ],
  cancelledAt: null,
  cancelReason: null,
  archive: { path: "letters/p1/l1_x.pdf", sha256: "a".repeat(64), size: 10 },
} as unknown as Letter;
const input = {
  code: "8F3KM-QRTVW",
  letter,
  typeName: "Surat Keterangan",
  contentPublic: false,
  unitName: "Sekretariat Jenderal",
  periodName: "2026/2027",
  digestMatches: true,
  typedName: null,
};

describe("names on the public page", () => {
  it("masks every word with three stars, whatever its length", () => {
    expect(maskName(" Arif  Nurwahid ")).toBe("A*** N***");
    expect(maskName("Élodie")).toBe("É***");
    expect(maskName("  ")).toBeNull();
  });

  it("matches the printed name ignoring case and spaces, not spelling", () => {
    expect(namesMatch("Arif  Nurwahid", "  arif nurwahid")).toBe(true);
    expect(namesMatch("Arif Nurwahid", "Arief Nurwahid")).toBe(false);
    expect(namesMatch("", "")).toBe(false);
    expect(namesMatch("Arif", null)).toBe(false);
  });
});

describe("what the verification page shows", () => {
  it("gated types open only with the exact recipient", () => {
    const closed = letterVerification(input);
    expect(closed).toMatchObject({
      kind: "letter",
      cancelled: false,
      number: "001/SKet/SEKJEN/PPIDK-ASIANIA/XI/2026",
      recipientMasked: "A*** N***",
      content: "needs_name",
      wrongName: false,
      bodyHtml: null,
      canDownload: false,
      signers: [{ desk: "Sekretaris Jenderal PPIDK Asia-Oseania", name: "Rina", signedAt: at }],
    });
    expect(letterVerification({ ...input, typedName: "Budi" })).toMatchObject({
      content: "needs_name",
      wrongName: true,
    });
    expect(letterVerification({ ...input, typedName: " " })).toMatchObject({ wrongName: false });
    expect(letterVerification({ ...input, typedName: "arif nurwahid" })).toMatchObject({
      content: "shown",
      bodyHtml: "<p>Isi</p>",
      canDownload: true,
      wrongName: false,
    });
  });

  it("public types show the content; changed content is shown to nobody", () => {
    expect(letterVerification({ ...input, contentPublic: true })).toMatchObject({
      content: "shown",
    });
    expect(
      letterVerification({ ...input, contentPublic: true, digestMatches: null }),
    ).toMatchObject({ content: "shown" });
    expect(
      letterVerification({
        ...input,
        contentPublic: true,
        digestMatches: false,
        typedName: "Arif Nurwahid",
      }),
    ).toMatchObject({
      content: "changed",
      bodyHtml: null,
      canDownload: false,
    });
    const noRecipient = { ...letter, recipient: "" };
    expect(letterVerification({ ...input, letter: noRecipient })).toMatchObject({
      content: "none",
      recipientMasked: null,
    });
  });

  it("cancelled letters say so and are never downloadable; unarchived ones neither", () => {
    const cancelled = {
      ...letter,
      status: "cancelled",
      cancelledAt: at,
      cancelReason: "Salah tanggal",
    } as Letter;
    expect(letterVerification({ ...input, letter: cancelled, contentPublic: true })).toMatchObject({
      cancelled: true,
      cancelReason: "Salah tanggal",
      content: "shown",
      canDownload: false,
    });
    const unarchived = { ...letter, archive: null, numberFormatted: null } as Letter;
    expect(letterVerification({ ...input, letter: unarchived, contentPublic: true })).toMatchObject(
      { canDownload: false, number: "" },
    );
  });
});
