import { PDFDocument, StandardFonts, type PDFPage } from "pdf-lib";
import { extractText } from "unpdf";
import { MM, MUTED, printable } from "./flow";
import { drawTurned, tryEmbed, type PdfImage } from "./letter";
import { qrPng } from "./qr";

/** A point in mm from the top-left corner of a page (1 = first page). */
export interface PageSpot {
  readonly page: number;
  readonly xMm: number;
  readonly yMm: number;
}

export interface StampInput {
  readonly signatures: readonly {
    readonly spot: PageSpot;
    readonly image: PdfImage;
    readonly widthMm: number;
    readonly rotation: number;
  }[];
  /** The verification QR with the code (and address) printed under it. */
  readonly qr: {
    readonly spot: PageSpot;
    readonly sizeMm: number;
    readonly url: string;
    readonly label: string;
    readonly code: string;
  } | null;
}

/** The PDF cannot be opened for stamping (locked with a password, or damaged). */
export class UnreadablePdfError extends Error {
  override readonly name = "UnreadablePdfError";
}

/** Opens the author's PDF; refuses one pdf-lib cannot read (encrypted, damaged). */
export async function openPdf(bytes: Uint8Array): Promise<PDFDocument> {
  const pages = async () => {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    return doc.getPageCount() > 0 ? doc : null;
  };
  // Damaged files fail in load or only when their pages are looked up.
  const doc = await pages().catch(() => null);
  if (!doc) {
    throw new UnreadablePdfError(
      "This PDF cannot be read: export it again without a password, then upload it.",
    );
  }
  return doc;
}

/**
 * Upload path (D3, PPIDK `TempelTandaTangan`): the signatures and the QR stamped on the author's
 * own PDF. Nothing to stamp = the file byte for byte. A spot past the last page goes on the last
 * page. The same function makes the preview and the archive, so what was seen is what is kept.
 */
export async function stampPdf(bytes: Uint8Array, input: StampInput): Promise<Uint8Array> {
  const doc = await openPdf(bytes);
  if (input.signatures.length === 0 && !input.qr) return bytes;
  const pages = doc.getPages();
  const at = (spot: PageSpot) => {
    const page = pages[Math.min(spot.page, pages.length) - 1] as PDFPage;
    const { width, height } = page.getSize();
    return { page, width, x: spot.xMm * MM, top: height - spot.yMm * MM };
  };
  for (const signature of input.signatures) {
    const image = await tryEmbed(doc, signature.image);
    if (!image) continue; // a broken signature never blocks a letter
    const { page, width, x, top } = at(signature.spot);
    drawTurned(page, image, {
      x,
      top,
      width: signature.widthMm * MM,
      max: Math.max(width - x, 10 * MM),
      rotation: signature.rotation,
    });
  }
  if (input.qr) {
    const { page, x, top } = at(input.qr.spot);
    const size = input.qr.sizeMm * MM;
    const image = await doc.embedPng(await qrPng(input.qr.url, 300));
    page.drawImage(image, { x, y: top - size, width: size, height: size });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const lines = [printable(input.qr.code), printable(input.qr.label)];
    lines.forEach((text, i) => {
      page.drawText(text, {
        x,
        y: top - size - 8 - i * 7,
        size: i === 0 ? 7 : 5.5,
        font,
        color: MUTED,
      });
    });
  }
  return doc.save();
}

/** The PDF's text layer ("" when it has none or cannot be read: a scan, an odd encoder). */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  try {
    // pdf.js takes over (detaches) the buffer it is given: hand it a copy.
    const { text } = await extractText(new Uint8Array(bytes), { mergePages: true });
    return text;
  } catch {
    return "";
  }
}
