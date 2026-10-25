import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { pdfText, qrPng, renderCertificatePdf, type CertificatePdfInput } from "@website/pdf";

const base: CertificatePdfInput = {
  parentName: "Perhimpunan Pelajar Indonesia Dunia",
  mainName: "PPIDK Asia-Oseania",
  emblem: null,
  number: "007.037/SERT/LKMM/SEKJEN/XI/2026",
  holderName: "Arif Nurwahid, S.Kom.",
  note: "Narasumber",
  citation: "atas partisipasinya dalam kegiatan\nLatihan Kepemimpinan dan Manajemen Mahasiswa 2026",
  placeAndDate: "Tokyo, 2 November 2026",
  desks: [
    {
      label: "Koordinator PPIDK Asia-Oseania",
      name: "Budi",
      signedOn: "2 November 2026",
      signature: null,
    },
    {
      label: "Sekretaris Jenderal PPIDK Asia-Oseania",
      name: "Rina",
      signedOn: "2 November 2026",
      signature: null,
    },
  ],
  verification: {
    url: "https://verif.ppiasiania.id/8F3KM-QRTVW",
    label: "verif.ppiasiania.id",
    code: "8F3KM-QRTVW",
  },
  cancelled: false,
};

describe("certificate sheet PDF (D5)", () => {
  it("one landscape page with the holder, number, citation, desks and QR", async () => {
    const emblem = { bytes: await qrPng("emblem", 80), type: "png" as const };
    const bytes = await renderCertificatePdf({ ...base, emblem });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeGreaterThan(height);
    const text = await pdfText(bytes);
    for (const part of [
      "SERTIFIKAT",
      "Arif Nurwahid, S.Kom.",
      "Narasumber",
      "007.037/SERT",
      "8F3KM-QRTVW",
      "Ditandatangani secara elektronik",
    ]) {
      expect(text).toContain(part);
    }
    expect(doc.getTitle()).toBe("Sertifikat Arif Nurwahid, S.Kom.");
  });

  it("drafts have no number or QR; signature images, emblem, the cancelled stamp", async () => {
    const png = { bytes: await qrPng("sig", 120), type: "png" as const };
    const bytes = await renderCertificatePdf({
      ...base,
      emblem: { bytes: new Uint8Array([1, 2, 3]), type: "png" },
      number: null,
      note: null,
      verification: null,
      placeAndDate: null,
      cancelled: true,
      desks: [
        {
          label: "Sekretaris Jenderal",
          name: "Rina",
          signedOn: "2 November 2026",
          signature: { image: png, widthMm: 60, rotation: 5 },
        },
        { label: "Koordinator", name: null, signedOn: null, signature: null },
      ],
    });
    const text = await pdfText(bytes);
    expect(text).toContain("Nomor diberikan saat angkatan diterbitkan");
    expect(text).toContain("DIBATALKAN");
    expect(text).not.toContain("8F3KM");
  });
});
