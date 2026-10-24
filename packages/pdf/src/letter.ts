import { PDFDocument, rgb, type PDFImage, type PDFPage } from "pdf-lib";
import { htmlToBlocks } from "./html";
import { A4, embedTimes, Flow, INK, MM, MUTED, plain } from "./flow";
import { qrPng } from "./qr";

/** A PNG or JPEG (convert WebP uploads before rendering). */
export interface PdfImage {
  readonly bytes: Uint8Array;
  readonly type: "png" | "jpeg";
}

/** The letterhead frozen on the letter at issue (PPIDK `kop_snapshot`). */
export interface LetterheadArt {
  readonly parentName: string;
  readonly mainName: string;
  readonly address: string;
  readonly period: string | null;
  /** Full-width images designed outside (e.g. Canva); text letterhead when absent. */
  readonly header: PdfImage | null;
  readonly footer: PdfImage | null;
  readonly watermark: PdfImage | null;
  /** 0.02-0.4 */
  readonly watermarkOpacity: number;
  /** Emblem of the text letterhead. */
  readonly emblem: PdfImage | null;
  /** Small "Paraf" box above the footer. */
  readonly initialsBox: boolean;
}

export interface LetterDesk {
  /** "Sekretaris Jenderal PPIDK Asia-Oseania", or the unit's name. */
  readonly label: string;
  readonly name: string | null;
  /** "2 November 2026" once signed; null = waiting. */
  readonly signedOn: string | null;
  /** The signer's own signature image (step 4.6), printed only once signed. */
  readonly signature: { readonly image: PdfImage; readonly widthMm: number } | null;
}

export interface LetterPdfInput {
  readonly letterhead: LetterheadArt;
  /** "Tokyo, 2 November 2026" is built from these. */
  readonly place: string;
  readonly dateText: string | null;
  readonly number: string | null;
  readonly attachment: string;
  readonly subject: string;
  readonly typeName: string;
  readonly recipient: string;
  /** Sanitized HTML. */
  readonly bodyHtml: string;
  /** One desk (right column) or two (Coordinator left, Secretary-General right). */
  readonly desks: readonly LetterDesk[];
  /** The QR and the line under it; null for drafts. */
  readonly verification: {
    readonly url: string;
    readonly label: string;
    readonly code: string;
  } | null;
  readonly cancelledReason: string | null;
}

const SIDE = 22 * MM;
const BREATH = 8 * MM;

const embedImage = (doc: PDFDocument, image: PdfImage): Promise<PDFImage> =>
  image.type === "png" ? doc.embedPng(image.bytes) : doc.embedJpg(image.bytes);

const embed = (doc: PDFDocument, image: PdfImage | null) =>
  image ? embedImage(doc, image) : Promise.resolve(null);

/** Height on paper of a full-width (210 mm) image. */
const fullWidthHeight = (image: PDFImage | null) =>
  image ? (A4.width * image.height) / image.width : 0;

/**
 * An A4 letter (D1/D9), laid out like PPIDK's `surat/pdf.blade.php`: letterhead (images on every
 * page, or a text letterhead), place and date, number / attachment / subject / type, recipient,
 * the body (justified, first-line indent 1.27 cm), the signing desks with their electronic
 * signature boxes, and the verification QR with its code.
 */
export async function renderLetterPdf(input: LetterPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(input.number ? `${input.number} — ${input.subject}` : input.subject);
  doc.setCreator("PPIDK Asia-Oseania");
  const fonts = await embedTimes(doc);
  const art = input.letterhead;
  const [header, footer, watermark, emblem] = await Promise.all([
    embed(doc, art.header),
    embed(doc, art.footer),
    embed(doc, art.watermark),
    embed(doc, art.emblem),
  ]);
  const headerHeight = fullWidthHeight(header);
  const footerHeight = fullWidthHeight(footer);
  const initials = art.initialsBox ? 20 * MM : 0;
  const marginTop = header ? headerHeight + BREATH : 22 * MM;
  const marginBottom = footer || initials ? footerHeight + initials + BREATH : 20 * MM;

  const decorate = (page: PDFPage) => {
    if (watermark) {
      page.drawImage(watermark, {
        x: 0,
        y: 0,
        width: A4.width,
        height: A4.height,
        opacity: Math.min(0.4, Math.max(0.02, art.watermarkOpacity)),
      });
    }
    if (header)
      page.drawImage(header, {
        x: 0,
        y: A4.height - headerHeight,
        width: A4.width,
        height: headerHeight,
      });
    if (footer) page.drawImage(footer, { x: 0, y: 0, width: A4.width, height: footerHeight });
    if (art.initialsBox) {
      const box = {
        x: A4.width - SIDE - 20 * MM,
        y: footerHeight + 2 * MM,
        width: 20 * MM,
        height: 16 * MM,
      };
      page.drawRectangle({ ...box, borderColor: MUTED, borderWidth: 0.6 });
      page.drawText("Paraf", {
        x: box.x + 7 * MM,
        y: box.y + box.height - 9,
        size: 6.5,
        font: fonts.regular,
        color: MUTED,
      });
    }
  };
  const flow = new Flow(doc, fonts, { marginTop, marginBottom, marginX: SIDE, decorate });

  if (!header) {
    const top = flow.y;
    if (emblem) {
      const w = 66 * 0.75;
      const h = (w * emblem.height) / emblem.width;
      flow.page.drawImage(emblem, { x: SIDE, y: top - h, width: w, height: h });
    }
    flow.text(plain(art.parentName), { size: 12, align: "center", lineHeight: 15 });
    flow.text(plain(art.mainName, { bold: true }), { size: 15.5, align: "center", lineHeight: 19 });
    const address = art.period ? `${art.address} · Kepengurusan ${art.period}` : art.address;
    flow.text(plain(address), { size: 8.6, align: "center", lineHeight: 11, color: MUTED });
    flow.gap(8);
    flow.page.drawLine({
      start: { x: SIDE, y: flow.y },
      end: { x: A4.width - SIDE, y: flow.y },
      thickness: 1.9,
      color: INK,
    });
    flow.page.drawLine({
      start: { x: SIDE, y: flow.y - 3 },
      end: { x: A4.width - SIDE, y: flow.y - 3 },
      thickness: 0.75,
      color: INK,
    });
    flow.gap(22);
  }

  if (input.dateText) {
    flow.text(plain(`${input.place || "Asia-Oseania"}, ${input.dateText}`), { align: "right" });
    flow.gap(8);
  }

  // Number / attachment / subject / type: label, colon, value (the value wraps in its column).
  const label = 58;
  const colon = 9;
  const meta: Array<[string, string, boolean]> = [
    ["Nomor", input.number ?? "(belum bernomor — belum terbit)", false],
    ["Lampiran", input.attachment.trim() || "-", false],
    ["Perihal", input.subject, true],
    ...(input.typeName
      ? ([["Jenis", input.typeName, false]] as Array<[string, string, boolean]>)
      : []),
  ];
  for (const [name, value, bold] of meta) {
    flow.ensure(18);
    const y = flow.y;
    flow.text(plain(name), { width: label });
    flow.y = y;
    flow.text(plain(":"), { x: SIDE + label, width: colon });
    flow.y = y;
    flow.text(plain(value, { bold }), {
      x: SIDE + label + colon,
      width: flow.width - label - colon,
    });
  }
  flow.gap(12);

  if (input.recipient.trim()) {
    flow.text(plain("Kepada Yth."));
    flow.text(plain(input.recipient, { bold: true }));
    flow.text(plain("di tempat"));
    flow.gap(12);
  }

  for (const block of htmlToBlocks(input.bodyHtml)) {
    if (block.kind === "rule") {
      flow.ensure(10);
      flow.page.drawLine({
        start: { x: SIDE, y: flow.y - 5 },
        end: { x: A4.width - SIDE, y: flow.y - 5 },
        thickness: 0.5,
        color: MUTED,
      });
      flow.gap(10);
    } else if (block.kind === "heading") {
      flow.gap(4);
      flow.text(
        block.runs.map((r) => ({ ...r, bold: true })),
        { size: block.level <= 2 ? 13 : 12, align: block.align },
      );
    } else if (block.kind === "item") {
      const indent = 18 * (block.depth + 1);
      flow.ensure(18);
      if (block.marker)
        flow.page.drawText(block.marker, {
          x: SIDE + indent - 14,
          y: flow.y - 12,
          size: 12,
          font: fonts.regular,
          color: INK,
        });
      flow.text(block.runs, { x: SIDE + indent, width: flow.width - indent, align: "justify" });
    } else {
      const indent = block.quote ? 24 : 0;
      flow.text(block.runs, {
        x: SIDE + indent,
        width: flow.width - 2 * indent,
        align: block.align,
        firstIndent: block.align === "justify" && !block.quote ? 12.7 * MM : 0,
      });
      flow.gap(3);
    }
  }

  // Signing desks, kept together on one page.
  flow.gap(26);
  flow.ensure(120);
  const column = flow.width * 0.46;
  const columns =
    input.desks.length > 1 ? [SIDE, A4.width - SIDE - column] : [A4.width - SIDE - column];
  const deskTop = flow.y;
  let lowest = flow.y;
  for (const [i, desk] of input.desks.entries()) {
    flow.y = deskTop;
    const x = columns[i] as number;
    flow.text(plain(desk.label), { x, width: column });
    flow.gap(5);
    if (desk.signedOn && desk.signature) {
      const image = await embedImage(doc, desk.signature.image);
      const w = desk.signature.widthMm * MM;
      const h = (w * image.height) / image.width;
      flow.page.drawImage(image, { x, y: flow.y - h, width: w, height: h });
      flow.gap(h + 3);
      flow.text(plain(desk.signedOn), {
        x,
        width: column,
        size: 7.8,
        lineHeight: 10,
        color: MUTED,
      });
    } else {
      const signed = desk.signedOn !== null;
      const height = signed ? 30 : 20;
      flow.page.drawRectangle({
        x,
        y: flow.y - height,
        width: column,
        height,
        borderColor: signed ? rgb(0.65, 0.76, 0.73) : rgb(0.81, 0.78, 0.72),
        borderWidth: 1,
        ...(signed ? {} : { borderDashArray: [3, 2] }),
        color: signed ? rgb(0.95, 0.97, 0.96) : rgb(0.98, 0.98, 0.96),
      });
      const y = flow.y;
      flow.gap(5);
      flow.text(
        plain(signed ? "Ditandatangani secara elektronik" : "Menunggu tanda tangan elektronik", {
          bold: signed,
          italic: !signed,
        }),
        {
          x: x + 7,
          width: column - 14,
          size: 8,
          lineHeight: 10,
          color: signed ? rgb(0.14, 0.35, 0.31) : rgb(0.54, 0.51, 0.46),
        },
      );
      if (signed)
        flow.text(plain(desk.signedOn), {
          x: x + 7,
          width: column - 14,
          size: 7.8,
          lineHeight: 10,
          color: rgb(0.36, 0.49, 0.46),
        });
      flow.y = y - height - 6;
    }
    flow.text(
      plain(desk.name ?? ".....................", { bold: true, underline: desk.name !== null }),
      { x, width: column },
    );
    lowest = Math.min(lowest, flow.y);
  }
  flow.y = lowest;

  if (input.verification) {
    flow.gap(14);
    flow.text(
      plain("Dokumen ini diterbitkan secara elektronik dan tidak memerlukan tanda tangan basah.", {
        italic: true,
      }),
      { size: 8.6, lineHeight: 12, color: MUTED },
    );
  }

  if (input.cancelledReason !== null) {
    flow.gap(10);
    flow.ensure(30);
    const text = `SURAT INI TELAH DIBATALKAN${input.cancelledReason ? ` — ${input.cancelledReason}` : ""}`;
    const red = rgb(0.69, 0, 0);
    const top = flow.y;
    flow.gap(6);
    flow.text(plain(text, { bold: true }), {
      x: SIDE + 8,
      width: flow.width - 16,
      size: 10,
      lineHeight: 13,
      color: red,
    });
    flow.gap(4);
    flow.page.drawRectangle({
      x: SIDE,
      y: flow.y,
      width: flow.width,
      height: top - flow.y,
      borderColor: red,
      borderWidth: 1.1,
    });
  }

  if (input.verification) {
    const size = 20.6 * MM;
    flow.gap(24);
    flow.ensure(size + 12);
    flow.page.drawLine({
      start: { x: SIDE, y: flow.y },
      end: { x: A4.width - SIDE, y: flow.y },
      thickness: 0.75,
      color: rgb(0.73, 0.73, 0.73),
    });
    flow.gap(8);
    const qr = await doc.embedPng(await qrPng(input.verification.url, 300));
    flow.page.drawImage(qr, { x: SIDE, y: flow.y - size, width: size, height: size });
    const y = flow.y;
    flow.y -= size / 2 - 18;
    flow.text(
      [
        ...plain(
          "Keaslian surat ini dapat diperiksa dengan memindai kode di samping atau membuka ",
        ),
        ...plain(input.verification.label, { bold: true }),
        ...plain(". Kode verifikasi: "),
        ...plain(input.verification.code, { bold: true }),
        ...plain("."),
      ],
      {
        x: SIDE + size + 10,
        width: flow.width - size - 10,
        size: 8.4,
        lineHeight: 11,
        color: MUTED,
      },
    );
    flow.y = Math.min(flow.y, y - size);
  }

  return doc.save();
}
