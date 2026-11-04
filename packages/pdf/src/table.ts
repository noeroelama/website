import { PDFDocument, rgb } from "pdf-lib";
import { embedTimes, Flow, MM, MUTED, plain, wrapRuns } from "./flow";

const RULE = rgb(0.75, 0.75, 0.75);
const SIZE = 9;
const LINE = SIZE * 1.35;
const PAD = 1.5 * MM;

export interface TableColumn {
  readonly header: string;
  /** Share of the text width (the shares should add up to 1). */
  readonly width: number;
  readonly align?: "left" | "right";
}

export interface TableSection {
  readonly heading: string;
  readonly rows: readonly (readonly string[])[];
  /** Lines printed under the rows (totals). */
  readonly summary: readonly string[];
}

export interface TablePdfInput {
  readonly title: string;
  /** Lines under the title (period, range, when it was made). */
  readonly lines: readonly string[];
  readonly columns: readonly TableColumn[];
  readonly sections: readonly TableSection[];
  /** Shown when there are no sections. */
  readonly empty: string;
}

/**
 * A plain A4 report (cash report, I3): a title, then per section a heading, a table whose header
 * is repeated on every new page, and summary lines. Cells wrap; a row never splits across pages.
 */
export async function renderTablePdf(input: TablePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(input.title);
  const fonts = await embedTimes(doc);
  const flow = new Flow(doc, fonts, {
    marginTop: 18 * MM,
    marginBottom: 18 * MM,
    marginX: 15 * MM,
    decorate: () => undefined,
  });
  flow.text(plain(input.title, { bold: true }), { size: 14 });
  for (const line of input.lines) flow.text(plain(line), { size: SIZE + 1, color: MUTED });

  const widths = input.columns.map((c) => c.width * flow.width);
  const xs = widths.map((_, i) => flow.left + widths.slice(0, i).reduce((a, b) => a + b, 0));
  const heightOf = (cells: readonly string[]) =>
    Math.max(
      ...widths.map((w, i) => wrapRuns(plain(cells[i] ?? ""), fonts, SIZE, w - PAD).length),
    ) *
      LINE +
    2;

  const row = (cells: readonly string[], bold: boolean) => {
    const top = flow.y;
    input.columns.forEach((column, i) => {
      flow.y = top;
      flow.text(plain(cells[i] ?? "", { bold }), {
        size: SIZE,
        lineHeight: LINE,
        x: (xs[i] as number) + PAD / 2,
        width: (widths[i] as number) - PAD,
        align: column.align ?? "left",
      });
    });
    flow.y = top - heightOf(cells);
    flow.page.drawLine({
      start: { x: flow.left, y: flow.y + 1 },
      end: { x: flow.left + flow.width, y: flow.y + 1 },
      thickness: 0.4,
      color: RULE,
    });
  };
  const header = input.columns.map((c) => c.header);

  if (input.sections.length === 0) flow.text(plain(input.empty), { size: SIZE + 1 });
  for (const section of input.sections) {
    flow.gap(LINE);
    // The heading, the header and the first row stay together.
    flow.ensure(LINE * 2 + heightOf(header) + heightOf(section.rows[0] ?? []));
    flow.text(plain(section.heading, { bold: true }), { size: SIZE + 2 });
    row(header, true);
    for (const cells of section.rows) {
      const page = flow.page;
      flow.ensure(heightOf(cells));
      if (flow.page !== page) row(header, true);
      row(cells, false);
    }
    for (const line of section.summary) flow.text(plain(line, { bold: true }), { size: SIZE + 1 });
  }
  return doc.save();
}
