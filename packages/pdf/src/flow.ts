import {
  rgb,
  StandardFonts,
  type PDFDocument,
  type PDFFont,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import type { Align, Run } from "./html";

export const MM = 72 / 25.4;
export const A4 = { width: 210 * MM, height: 297 * MM };
export const INK = rgb(0.067, 0.067, 0.067);
export const MUTED = rgb(0.27, 0.27, 0.27);

const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

export function printable(text: string): string {
  let out = "";
  for (const ch of text.replace(/[\t\u00a0\u2000-\u200b\u202f]/g, " ")) {
    const code = ch.codePointAt(0) as number;
    out +=
      (code >= 0x20 && code <= 0x7e) || (code >= 0xa1 && code <= 0xff) || WIN_ANSI_EXTRA.has(ch)
        ? ch
        : "?";
  }
  return out;
}

export interface Fonts {
  readonly regular: PDFFont;
  readonly bold: PDFFont;
  readonly italic: PDFFont;
  readonly boldItalic: PDFFont;
}

export async function embedTimes(doc: PDFDocument): Promise<Fonts> {
  const [regular, bold, italic, boldItalic] = await Promise.all([
    doc.embedFont(StandardFonts.TimesRoman),
    doc.embedFont(StandardFonts.TimesRomanBold),
    doc.embedFont(StandardFonts.TimesRomanItalic),
    doc.embedFont(StandardFonts.TimesRomanBoldItalic),
  ]);
  return { regular, bold, italic, boldItalic };
}

export const fontOf = (fonts: Fonts, run: Pick<Run, "bold" | "italic">) =>
  run.bold
    ? run.italic
      ? fonts.boldItalic
      : fonts.bold
    : run.italic
      ? fonts.italic
      : fonts.regular;

interface Piece {
  readonly text: string;
  readonly run: Run;
  readonly width: number;
  readonly space: boolean;
}

export interface Line {
  readonly pieces: Piece[];
  readonly width: number;
  readonly last: boolean;
}

export function wrapRuns(
  runs: readonly Run[],
  fonts: Fonts,
  size: number,
  width: number,
  firstIndent = 0,
): Line[] {
  const lines: Line[] = [];
  let pieces: Piece[] = [];
  let used = 0;
  const limit = () => width - (lines.length === 0 ? firstIndent : 0);
  const finish = (last: boolean) => {
    while (pieces.length > 0 && pieces.at(-1)?.space) pieces.pop();
    lines.push({ pieces, width: pieces.reduce((n, p) => n + p.width, 0), last });
    pieces = [];
    used = 0;
  };
  for (const run of runs) {
    if (run.text === "\n") {
      finish(true);
      continue;
    }
    const font = fontOf(fonts, run);
    for (const token of printable(run.text).split(/( )/)) {
      if (token === "") continue;
      const space = token === " ";
      if (space && pieces.length === 0) continue;
      let text = token;
      let w = font.widthOfTextAtSize(text, size);
      if (!space && used + w > limit() && pieces.length > 0) finish(false);
      while (!space && w > limit()) {
        let cut = text.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(text.slice(0, cut), size) > limit() - used)
          cut -= 1;
        pieces.push({
          text: text.slice(0, cut),
          run,
          width: font.widthOfTextAtSize(text.slice(0, cut), size),
          space: false,
        });
        finish(false);
        text = text.slice(cut);
        w = font.widthOfTextAtSize(text, size);
      }
      pieces.push({ text, run, width: w, space });
      used += w;
    }
  }
  if (pieces.length > 0 || lines.length === 0) finish(true);
  else lines[lines.length - 1] = { ...(lines.at(-1) as Line), last: true };
  return lines;
}

export interface FlowOptions {
  readonly marginTop: number;
  readonly marginBottom: number;
  readonly marginX: number;
  readonly decorate: (page: PDFPage) => void;
}

export class Flow {
  page: PDFPage;
  y: number;
  constructor(
    readonly doc: PDFDocument,
    readonly fonts: Fonts,
    readonly options: FlowOptions,
  ) {
    this.page = this.addPage();
    this.y = A4.height - options.marginTop;
  }

  get width() {
    return A4.width - 2 * this.options.marginX;
  }

  get left() {
    return this.options.marginX;
  }

  private addPage() {
    const page = this.doc.addPage([A4.width, A4.height]);
    this.options.decorate(page);
    return page;
  }

  ensure(height: number) {
    if (this.y - height < this.options.marginBottom) {
      this.page = this.addPage();
      this.y = A4.height - this.options.marginTop;
    }
  }

  gap(points: number) {
    this.y -= points;
  }

  text(
    runs: readonly Run[],
    options: {
      size?: number;
      align?: Align;
      lineHeight?: number;
      firstIndent?: number;
      x?: number;
      width?: number;
      color?: RGB;
    } = {},
  ) {
    const size = options.size ?? 12;
    const lineHeight = options.lineHeight ?? size * 1.5;
    const x = options.x ?? this.left;
    const width = options.width ?? this.width;
    const align = options.align ?? "left";
    const lines = wrapRuns(runs, this.fonts, size, width, options.firstIndent ?? 0);
    lines.forEach((line, i) => {
      this.ensure(lineHeight);
      const indent = i === 0 ? (options.firstIndent ?? 0) : 0;
      const free = width - indent - line.width;
      const spaces = line.pieces.filter((p) => p.space).length;
      const stretch = align === "justify" && !line.last && spaces > 0 ? free / spaces : 0;
      let cursor = x + indent + (align === "center" ? free / 2 : align === "right" ? free : 0);
      const baseline = this.y - size;
      for (const piece of line.pieces) {
        if (piece.space) {
          if (piece.run.underline) {
            this.page.drawLine({
              start: { x: cursor, y: baseline - 1.5 },
              end: { x: cursor + piece.width + stretch, y: baseline - 1.5 },
              thickness: 0.6,
              color: options.color ?? INK,
            });
          }
          cursor += piece.width + stretch;
          continue;
        }
        this.page.drawText(piece.text, {
          x: cursor,
          y: baseline,
          size,
          font: fontOf(this.fonts, piece.run),
          color: options.color ?? INK,
        });
        if (piece.run.underline) {
          this.page.drawLine({
            start: { x: cursor, y: baseline - 1.5 },
            end: { x: cursor + piece.width, y: baseline - 1.5 },
            thickness: 0.6,
            color: options.color ?? INK,
          });
        }
        cursor += piece.width;
      }
      this.y -= lineHeight;
    });
    return lines.length * lineHeight;
  }
}

export const plain = (text: string, style: Partial<Omit<Run, "text">> = {}): Run[] => [
  { text, bold: false, italic: false, underline: false, ...style },
];
