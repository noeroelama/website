import { degrees, PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { embedTimes, INK, MM, MUTED, plain, printable, wrapRuns, type Fonts } from "./flow";
import { drawTurned, tryEmbed, type LetterDesk, type PdfImage } from "./letter";
import { qrPng } from "./qr";

/** A4 landscape. */
const PAGE = { width: 297 * MM, height: 210 * MM };
const RED = rgb(0.54, 0.106, 0.106);
const GOLD = rgb(0.79, 0.635, 0.153);

export interface CertificatePdfInput {
  readonly parentName: string;
  readonly mainName: string;
  readonly emblem: PdfImage | null;
  /** The sheet's number; null before the batch is issued. */
  readonly number: string | null;
  readonly holderName: string;
  readonly note: string | null;
  /** Plain lines under the name ("atas partisipasinya dalam kegiatan ..."). */
  readonly citation: string;
  /** "Tokyo, 2 November 2026" */
  readonly placeAndDate: string | null;
  /** One or two desks, printed right (Coordinator left of the Secretary-General). */
  readonly desks: readonly LetterDesk[];
  readonly verification: {
    readonly url: string;
    readonly label: string;
    readonly code: string;
  } | null;
  readonly cancelled: boolean;
}

/** Centred, wrapped lines; returns the y under the last one. */
function centred(
  page: PDFPage,
  fonts: Fonts,
  text: string,
  y: number,
  options: { size: number; bold?: boolean; color?: typeof INK; width?: number },
) {
  const width = options.width ?? PAGE.width - 60 * MM;
  const font: PDFFont = options.bold ? fonts.bold : fonts.regular;
  let line = y;
  for (const paragraph of text.split("\n")) {
    for (const wrapped of wrapRuns(plain(paragraph), fonts, options.size, width)) {
      const words = wrapped.pieces.map((p) => p.text).join("");
      page.drawText(words, {
        x: (PAGE.width - font.widthOfTextAtSize(words, options.size)) / 2,
        y: line - options.size,
        size: options.size,
        font,
        color: options.color ?? INK,
      });
      line -= options.size * 1.4;
    }
  }
  return line;
}

/**
 * One certificate sheet (D5, PPIDK `sertifikat/pdf.blade.php`): landscape, double frame, no
 * letterhead band (it would read as a letter) — the emblem and the names only. Rendered on
 * demand, never stored: the batch frozen at issue makes it the same years later.
 */
export async function renderCertificatePdf(input: CertificatePdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Sertifikat ${input.holderName}`);
  const fonts = await embedTimes(doc);
  const page = doc.addPage([PAGE.width, PAGE.height]);
  const frame = (inset: number, width: number, color: typeof RED) =>
    page.drawRectangle({
      x: inset,
      y: inset,
      width: PAGE.width - 2 * inset,
      height: PAGE.height - 2 * inset,
      borderColor: color,
      borderWidth: width,
    });
  frame(9 * MM, 2.2 * MM, RED);
  frame(12 * MM, 0.4 * MM, GOLD);

  let y = PAGE.height - 22 * MM;
  const emblem = input.emblem && (await tryEmbed(doc, input.emblem));
  if (emblem) {
    const h = 18 * MM;
    const w = (h * emblem.width) / emblem.height;
    page.drawImage(emblem, { x: (PAGE.width - w) / 2, y: y - h, width: w, height: h });
    y -= h + 2 * MM;
  }
  y = centred(page, fonts, input.parentName.toUpperCase(), y, { size: 10 });
  y = centred(page, fonts, input.mainName.toUpperCase(), y, { size: 8.5, color: MUTED });
  y = centred(page, fonts, "SERTIFIKAT", y - 4 * MM, { size: 30, bold: true, color: RED });
  y = centred(page, fonts, input.number ?? "Nomor diberikan saat angkatan diterbitkan", y, {
    size: 9.5,
    color: MUTED,
  });
  y = centred(page, fonts, "Diberikan kepada", y - 4 * MM, { size: 10.5 });
  y = centred(page, fonts, input.holderName, y - 1 * MM, { size: 24, bold: true });
  page.drawLine({
    start: { x: PAGE.width / 2 - 70 * MM, y: y + 2 * MM },
    end: { x: PAGE.width / 2 + 70 * MM, y: y + 2 * MM },
    thickness: 0.4 * MM,
    color: GOLD,
  });
  if (input.note) y = centred(page, fonts, input.note, y - 1 * MM, { size: 10, color: RED });
  centred(page, fonts, input.citation, y - 2 * MM, { size: 11, width: PAGE.width - 80 * MM });

  // Footer: QR and code left; place and date, then the desks, right.
  const bottom = 22 * MM;
  const write = (text: string, x: number, at: number, size: number, font = fonts.regular) =>
    page.drawText(printable(text), {
      x,
      y: at,
      size,
      font,
      color: font === fonts.bold ? INK : MUTED,
    });
  if (input.verification) {
    const size = 22 * MM;
    const qr = await doc.embedPng(await qrPng(input.verification.url, 300));
    page.drawImage(qr, { x: 24 * MM, y: bottom + 6 * MM, width: size, height: size });
    write(input.verification.code, 24 * MM, bottom + 2.5 * MM, 7.5);
    write(input.verification.label, 24 * MM, bottom, 6);
  }
  const column = 62 * MM;
  const right = PAGE.width - 24 * MM;
  for (const [i, desk] of input.desks.entries()) {
    const x = right - (input.desks.length - i) * column;
    const top = bottom + 34 * MM;
    if (i === input.desks.length - 1 && input.placeAndDate) {
      write(input.placeAndDate, x, top + 3 * MM, 9.5);
    }
    write(desk.label, x, top - 1 * MM, 8.5);
    // The signer's own image only once that desk signed; a broken one prints nothing.
    const image =
      desk.signedOn && desk.signature ? await tryEmbed(doc, desk.signature.image) : null;
    if (image && desk.signature) {
      drawTurned(page, image, {
        x,
        top: top - 3 * MM,
        // At most 20 mm tall: the name is printed under it.
        width: Math.min(desk.signature.widthMm * MM, (20 * MM * image.width) / image.height),
        max: column - 4 * MM,
        rotation: desk.signature.rotation,
      });
    } else if (desk.signedOn) {
      write(`Ditandatangani secara elektronik, ${desk.signedOn}`, x, top - 12 * MM, 7.5);
    }
    write(desk.name ?? ".....................", x, bottom + 6 * MM, 9.5, fonts.bold);
  }

  if (input.cancelled) {
    page.drawText("DIBATALKAN", {
      x: PAGE.width / 2 - 75 * MM,
      y: PAGE.height / 2 - 30 * MM,
      size: 60,
      font: fonts.bold,
      color: RED,
      opacity: 0.25,
      rotate: degrees(20),
    });
  }
  return doc.save();
}
