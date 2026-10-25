import "server-only";
import type { FirestoreLetterStore, FirestoreSignatureStore } from "@website/db/firestore";
import {
  certificateCitation,
  deskLabel,
  desksOf,
  formatLetterDate,
  letterArchivePath,
  sheetNumber,
  verificationUrl,
  type Certificate,
  type LetterArchive,
  type Letter,
  type Letterhead,
  type LetterheadImage,
  type LetterType,
} from "@website/domain/documents";
import {
  renderCertificatePdf,
  renderLetterPdf,
  stampPdf,
  type LetterDesk,
  type LetterheadArt,
  type PdfImage,
} from "@website/pdf";
import { canAccessAdmin, can, type Principal } from "@website/permissions";
import { RuleViolationError } from "@website/domain/shared";
import { decryptField, jsonError, sha256Hex } from "@website/security";

export interface LetterPdfDeps {
  readonly storage: {
    read(path: string): Promise<Uint8Array | null>;
    save(
      path: string,
      bytes: Uint8Array,
      options: { visibility: "private"; contentType: "application/pdf" },
    ): Promise<unknown>;
  };
  readonly letters: Pick<FirestoreLetterStore, "setArchive">;
  /** Uploaded images are WebP; pdf-lib embeds PNG (sharp in the app). */
  readonly toPng: (bytes: Uint8Array) => Promise<Uint8Array>;
  /** VERIFICATION_HOST (e.g. verif.ppiasiania.id) and WEB_URL. */
  readonly verification: { readonly host: string | null; readonly webUrl: string | null };
  readonly uuid: () => string;
  /** Personal signatures (4.6): their records and FIELD_ENCRYPTION_KEY (null = none printed). */
  readonly signatures: Pick<FirestoreSignatureStore, "get">;
  readonly signatureKey: () => string | null;
}

type PrintedSignature = LetterDesk["signature"];

/** What the renderer needs besides the letter. */
export interface LetterContext {
  readonly type: LetterType;
  readonly unitName: string;
  /** Names of the desks' signers for letters not issued yet (uid → name). */
  readonly names: ReadonlyMap<string, string>;
  /** The current letterhead (drafts); issued letters use their frozen one. */
  readonly letterhead: Letterhead;
}

export class ArchiveDamagedError extends Error {
  override readonly name = "ArchiveDamagedError";
}

/** The desks as printed: Coordinator left, Secretary-General (or the unit) right. */
export function letterDesks(
  letter: Letter,
  context: LetterContext,
  signatures: ReadonlyMap<string, PrintedSignature> = new Map(),
): LetterDesk[] {
  const order = desksOf(context.type).includes("coordinator")
    ? (["coordinator", "secretary"] as const)
    : (["secretary"] as const);
  return order.map((desk) => {
    const signature = letter[desk];
    const label = deskLabel(desk, context.type, context.unitName);
    // Issued: the names frozen at issue (`signers` keeps the desk label).
    const frozen = letter.signers.find((s) => s.desk === label && signature !== null);
    return {
      label,
      name: frozen?.name ?? (signature ? (context.names.get(signature.uid) ?? null) : null),
      signedOn: signature ? formatLetterDate(signature.at) : null,
      signature: signature ? (signatures.get(signature.uid) ?? null) : null,
    };
  });
}

/** PDF and archive of letters (D1, D9; PPIDK `RenderSurat`). */
export function createLetterPdf(deps: LetterPdfDeps) {
  const image = async (art: LetterheadImage | null): Promise<PdfImage | null> => {
    if (!art) return null;
    const bytes = await deps.storage.read(art.path);
    // A lost image falls back to the text letterhead: a letter is never blocked by its art.
    return bytes ? { bytes: await deps.toPng(bytes), type: "png" } : null;
  };

  /** The signer's image, decrypted; null when there is none or it cannot be read. */
  async function signatureOf(uid: string): Promise<PrintedSignature> {
    const key = deps.signatureKey();
    const stored = key ? await deps.signatures.get(uid) : null;
    const file = stored ? await deps.storage.read(stored.path) : null;
    if (!key || !stored || !file) return null;
    try {
      const bytes = decryptField(new TextDecoder().decode(file), key);
      return {
        image: { bytes, type: stored.type },
        widthMm: stored.widthMm,
        rotation: stored.rotation,
      };
    } catch {
      return null;
    }
  }

  /** Signatures of the desks already signed (issued letters freeze them in the archive). */
  async function signaturesOf(letter: Letter) {
    const uids = [letter.coordinator?.uid, letter.secretary?.uid].filter(
      (uid): uid is string => uid !== undefined,
    );
    return new Map(
      await Promise.all(uids.map(async (uid) => [uid, await signatureOf(uid)] as const)),
    );
  }

  async function art(letterhead: Letterhead, period: string | null): Promise<LetterheadArt> {
    const [header, footer, watermark, emblem] = await Promise.all([
      image(letterhead.header),
      image(letterhead.footer),
      image(letterhead.watermark),
      image(letterhead.emblem),
    ]);
    return {
      parentName: letterhead.parentName,
      mainName: letterhead.mainName,
      address: letterhead.address,
      period,
      header,
      footer,
      watermark,
      emblem,
      watermarkOpacity: letterhead.watermarkOpacity / 100,
      initialsBox: letterhead.initialsBox,
    };
  }

  /** The QR address of a code (null = not numbered yet: drafts print no QR). */
  function verificationOf(code: string | null) {
    if (code === null) return null;
    const verification = verificationUrl(code, deps.verification);
    if (!verification) {
      throw new Error("Set VERIFICATION_HOST or WEB_URL: issued letters print their QR.");
    }
    return { ...verification, code };
  }

  /** Renders the letter now: drafts without number and QR, cancelled letters with the stamp. */
  async function render(letter: Letter, context: LetterContext, period: string | null) {
    const verification = verificationOf(letter.verificationCode);
    return renderLetterPdf({
      letterhead: await art(letter.letterhead ?? context.letterhead, period),
      place: letter.place,
      dateText: letter.letterDate ? formatLetterDate(letter.letterDate) : null,
      number: letter.numberFormatted,
      attachment: letter.attachmentNote,
      subject: letter.subject,
      typeName: context.type.name,
      recipient: letter.recipient,
      bodyHtml: letter.body,
      desks: letterDesks(letter, context, await signaturesOf(letter)),
      verification,
      cancelledReason: letter.status === "cancelled" ? (letter.cancelReason ?? "") : null,
    });
  }

  /**
   * The issued letter's archive, byte for byte: read and checked against its sha256, or (first
   * time) rendered, stored privately and recorded. Throws ArchiveDamagedError on a mismatch.
   */
  async function archive(
    letter: Letter,
    context: LetterContext,
    period: string | null,
  ): Promise<Uint8Array> {
    if (letter.archive) {
      const bytes = await deps.storage.read(letter.archive.path);
      if (!bytes || sha256Hex(bytes) !== letter.archive.sha256) {
        throw new ArchiveDamagedError("The archived PDF is missing or changed.");
      }
      return bytes;
    }
    const bytes = await render(letter, context, period);
    const path = letterArchivePath(letter, deps.uuid());
    await deps.storage.save(path, bytes, { visibility: "private", contentType: "application/pdf" });
    const stored = await deps.letters.setArchive(letter.id, {
      path,
      sha256: sha256Hex(bytes),
      size: bytes.length,
    });
    // Another request archived it first: serve that one (this render stays unused).
    return stored.path === path ? bytes : archive({ ...letter, archive: stored }, context, period);
  }

  /**
   * Upload path (D3): the author's PDF (sha256 checked) with the signatures of the signed desks
   * and the QR stamped where `placement` says. ONE function for the preview and the archive.
   */
  async function stampUpload(letter: Letter): Promise<Uint8Array> {
    const upload = letter.upload;
    const bytes = upload ? await deps.storage.read(upload.path) : null;
    if (!upload || !bytes || sha256Hex(bytes) !== upload.sha256) {
      // Never stamped (nor issued) unseen: the preview and the issue both refuse.
      throw new RuleViolationError("The uploaded PDF is missing or changed: upload it again.");
    }
    const placement = letter.placement;
    const signed = await signaturesOf(letter);
    const signatures = (["secretary", "coordinator"] as const).flatMap((desk) => {
      const spot = placement?.[desk];
      const image = signed.get(letter[desk]?.uid ?? "");
      return spot && image ? [{ spot, ...image }] : [];
    });
    const qr = placement?.qr ?? null;
    // A numbered letter always has its verification address (or verificationOf throws).
    const verification = verificationOf(letter.verificationCode) as NonNullable<
      ReturnType<typeof verificationOf>
    >;
    return stampPdf(bytes, { signatures, qr: qr && { spot: qr, ...qr, ...verification } });
  }

  /** Stores a finished PDF privately under a fresh name (never overwriting one). */
  async function saveFile(letter: Letter, bytes: Uint8Array): Promise<LetterArchive> {
    const path = letterArchivePath(letter, deps.uuid());
    await deps.storage.save(path, bytes, { visibility: "private", contentType: "application/pdf" });
    return { path, sha256: sha256Hex(bytes), size: bytes.length };
  }

  /**
   * One sheet of a certificate batch (D5), rendered on demand from the batch (its letterhead and
   * signers frozen at issue). Before issue: no number and no QR; a cancelled batch is stamped.
   */
  async function renderCertificate(batch: Letter, sheet: Certificate, context: LetterContext) {
    const letterhead = batch.letterhead ?? context.letterhead;
    const verification = verificationOf(batch.verificationCode && sheet.verificationCode);
    return renderCertificatePdf({
      parentName: letterhead.parentName,
      mainName: letterhead.mainName,
      emblem: await image(letterhead.emblem),
      number: sheetNumber(batch.sheetNumberTemplate, sheet.seq),
      holderName: sheet.name,
      note: sheet.note,
      citation: certificateCitation(batch.body, batch.subject),
      placeAndDate: batch.letterDate
        ? [batch.place, formatLetterDate(batch.letterDate)].filter(Boolean).join(", ")
        : null,
      desks: letterDesks(batch, context, await signaturesOf(batch)),
      verification,
      cancelled: batch.status === "cancelled",
    });
  }

  return { render, archive, stampUpload, saveFile, renderCertificate };
}

export type LetterPdf = ReturnType<typeof createLetterPdf>;

const notFound = () =>
  Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

/**
 * GET /api/letters/<id>/pdf: the letter as PDF for staff who may read it (its unit in their
 * scope; others get 404, so ids reveal nothing). Issued letters: the archive (made now if it is
 * missing); drafts and cancelled letters: rendered now (cancelled ones with the stamp).
 */
export function createLetterFileRoute(deps: {
  readonly getLetter: (id: string) => Promise<Letter | null>;
  readonly load: (
    letter: Letter,
  ) => Promise<{ context: LetterContext; period: string | null } | null>;
  readonly pdf: Pick<LetterPdf, "render" | "archive" | "stampUpload">;
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
}) {
  // Upload path before issue: the stamped preview once a file is in (nothing to show before).
  const previewUpload = (letter: Letter) =>
    letter.upload ? deps.pdf.stampUpload(letter) : Promise.resolve(null);

  return async (id: string, principal: Principal | null): Promise<Response> => {
    if (principal === null || !principal.active) return jsonError("unauthenticated");
    if (!canAccessAdmin(principal)) return jsonError("forbidden");
    const letter = await deps.getLetter(id);
    if (
      !letter ||
      letter.deletedAt ||
      !can(principal, "letters.read", { orgUnitPath: letter.orgUnitPath })
    ) {
      return notFound();
    }
    const loaded = letter.source === "certificate" ? null : await deps.load(letter);
    // A certificate batch has no letter PDF: each sheet has its own route.
    if (!loaded) return notFound();
    try {
      const bytes =
        letter.status === "issued"
          ? await deps.pdf.archive(letter, loaded.context, loaded.period)
          : letter.source === "upload"
            ? await previewUpload(letter)
            : await deps.pdf.render(letter, loaded.context, loaded.period);
      if (!bytes) return notFound();
      const name = (letter.numberFormatted ?? letter.subject).replace(/[^A-Za-z0-9._-]+/g, "-");
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${name.slice(0, 80) || "letter"}.pdf"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      deps.logError("letter pdf failed", { letterId: letter.id, error: String(error) });
      return jsonError("internal");
    }
  };
}
