import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from "pdf-lib";
import { openPdf, pdfText, qrPng, stampPdf, UnreadablePdfError } from "@website/pdf";

const textPdf = async (text: string, pages = 1) => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i += 1)
    doc.addPage().drawText(text, { x: 50, y: 700, size: 11, font });
  return doc.save({ useObjectStreams: false });
};
const images = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes)).context
    .enumerateIndirectObjects()
    .filter(
      ([, object]) =>
        object instanceof PDFRawStream &&
        object.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
    ).length;

describe("stamping the author's PDF (upload path)", () => {
  it("reads the text layer; a scan or a broken file has none", async () => {
    const text = await pdfText(await textPdf("Nomor: 001 / SOP / PPIDK-ASIANIA / 2026"));
    expect(text).toContain("001 / SOP");
    expect(await pdfText(await textPdf(""))).toBe("");
    expect(await pdfText(new TextEncoder().encode("%PDF-1.7 broken"))).toBe("");
  });

  it("keeps the file byte for byte when there is nothing to stamp", async () => {
    const bytes = await textPdf("x");
    expect(await stampPdf(bytes, { signatures: [], qr: null })).toBe(bytes);
  });

  it("stamps signatures and the QR (past the last page = the last page); skips a broken image", async () => {
    const bytes = await textPdf("x", 2);
    const image = { bytes: await qrPng("sig", 120), type: "png" as const };
    const stamped = await stampPdf(bytes, {
      signatures: [
        { spot: { page: 1, xMm: 120, yMm: 220 }, image, widthMm: 40, rotation: -5 },
        {
          spot: { page: 9, xMm: 20, yMm: 220 },
          image: { bytes: new Uint8Array([1, 2]), type: "png" },
          widthMm: 40,
          rotation: 0,
        },
      ],
      qr: {
        spot: { page: 9, xMm: 170, yMm: 250 },
        sizeMm: 22,
        url: "https://verif.ppiasiania.id/8F3KM-QRTVW",
        label: "verif.ppiasiania.id",
        code: "8F3KM-QRTVW",
      },
    });
    expect(await images(stamped)).toBe(2);
    const doc = await PDFDocument.load(stamped);
    expect(doc.getPageCount()).toBe(2);
    expect(await pdfText(stamped)).toContain("8F3KM-QRTVW");
  });

  it("stamps signatures alone, without a QR", async () => {
    const image = { bytes: await qrPng("sig", 120), type: "png" as const };
    const stamped = await stampPdf(await textPdf("x"), {
      signatures: [{ spot: { page: 1, xMm: 200, yMm: 20 }, image, widthMm: 80, rotation: 0 }],
      qr: null,
    });
    expect(await images(stamped)).toBe(1);
  });

  it("refuses a locked, damaged or empty PDF with a clear message", async () => {
    const plain = new TextDecoder("latin1").decode(await textPdf("x"));
    // A real Encrypt dictionary in the trailer, as a password-protected export has.
    const locked = new TextEncoder().encode(
      plain
        .replace("\nxref\n", "\n99 0 obj\n<< /Filter /Standard /V 1 >>\nendobj\n\nxref\n")
        .replace("trailer\n<<", "trailer\n<<\n/Encrypt 99 0 R"),
    );
    await expect(openPdf(locked)).rejects.toBeInstanceOf(UnreadablePdfError);
    await expect(openPdf(new TextEncoder().encode("%PDF-1.7"))).rejects.toThrow(
      "without a password",
    );
    const empty = await (await PDFDocument.create()).save({ addDefaultPage: false });
    await expect(stampPdf(empty, { signatures: [], qr: null })).rejects.toBeInstanceOf(
      UnreadablePdfError,
    );
  });
});
