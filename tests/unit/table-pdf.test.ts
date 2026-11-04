import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { pdfText, renderTablePdf, type TablePdfInput } from "@website/pdf";

const base: TablePdfInput = {
  title: "Laporan Kas / Cash report",
  lines: ["Period 2026/2027", "2026-11-01 – 2026-11-30"],
  columns: [
    { header: "Date", width: 0.2 },
    { header: "Description", width: 0.5 },
    { header: "Amount", width: 0.3, align: "right" },
  ],
  sections: [
    {
      heading: "IDR",
      rows: [
        ["2026-11-01", "Saldo awal", "1,000.00"],
        ["2026-11-02", "Webinar AI " + "panjang ".repeat(30), "-300.00"],
      ],
      summary: ["Closing balance: IDR 700.00"],
    },
  ],
  empty: "No entries.",
};

describe("table PDF (cash report, I3)", () => {
  it("prints the title, headings, rows and totals", async () => {
    const bytes = await renderTablePdf(base);
    const text = await pdfText(bytes);
    for (const part of [
      "Laporan Kas",
      "Period 2026/2027",
      "IDR",
      "Saldo awal",
      "-300.00",
      "Closing balance",
    ]) {
      expect(text).toContain(part);
    }
    expect((await PDFDocument.load(bytes)).getTitle()).toBe("Laporan Kas / Cash report");
  });

  it("repeats the header on new pages and says when there is nothing", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => [`2026-11-${i}`, `Entry ${i}`]);
    const bytes = await renderTablePdf({
      ...base,
      sections: [
        { heading: "JPY", rows, summary: [] },
        { heading: "AUD", rows: [], summary: [] },
      ],
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    const text = await pdfText(bytes);
    expect(text.split("Description").length - 1).toBe(doc.getPageCount() + 1);
    expect(await pdfText(await renderTablePdf({ ...base, sections: [] }))).toContain("No entries.");
  });
});
