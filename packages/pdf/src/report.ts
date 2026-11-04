import { PDFDocument } from "pdf-lib";
import { embedTimes, Flow, MM, MUTED, plain, printable } from "./flow";

/** A plain A4 report (LPJ): a title, then headed sections of text lines. */
export interface ReportPdfInput {
  readonly title: string;
  readonly subtitle: string;
  readonly sections: ReadonlyArray<{
    readonly heading: string;
    /** Paragraphs; "\n" inside one starts a new line. */
    readonly lines: readonly string[];
  }>;
  /** Small print at the end (e.g. when it was printed). */
  readonly footer: string;
}

/** Rendered on request, never stored (the data is the record, the PDF only a view of it). */
export async function renderReportPdf(input: ReportPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(printable(input.title));
  const fonts = await embedTimes(doc);
  const flow = new Flow(doc, fonts, {
    marginTop: 20 * MM,
    marginBottom: 20 * MM,
    marginX: 20 * MM,
    decorate: () => undefined,
  });
  flow.text(plain(printable(input.title), { bold: true }), { size: 16, align: "center" });
  flow.text(plain(printable(input.subtitle)), { size: 11, align: "center", color: MUTED });
  for (const section of input.sections) {
    flow.gap(8);
    flow.ensure(40);
    flow.text(plain(printable(section.heading), { bold: true }), { size: 12 });
    for (const paragraph of section.lines) {
      for (const line of paragraph.split("\n")) {
        flow.text(plain(printable(line || " ")), { size: 11, lineHeight: 15 });
      }
    }
  }
  flow.gap(12);
  flow.text(plain(printable(input.footer), { italic: true }), { size: 9, color: MUTED });
  return doc.save();
}
