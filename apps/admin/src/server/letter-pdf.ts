import "server-only";
import type { FirestoreLetterStore } from "@website/db/firestore";
import {
  deskLabel,
  desksOf,
  formatLetterDate,
  letterArchivePath,
  verificationUrl,
  type Letter,
  type Letterhead,
  type LetterheadImage,
  type LetterType,
} from "@website/domain/documents";
import { renderLetterPdf, type LetterDesk, type LetterheadArt, type PdfImage } from "@website/pdf";
import { canAccessAdmin, can, type Principal } from "@website/permissions";
import { jsonError, sha256Hex } from "@website/security";

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
}

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
export function letterDesks(letter: Letter, context: LetterContext): LetterDesk[] {
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
      signature: null,
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

  /** Renders the letter now: drafts without number and QR, cancelled letters with the stamp. */
  async function render(letter: Letter, context: LetterContext, period: string | null) {
    const numbered = letter.verificationCode !== null;
    const verification = numbered
      ? verificationUrl(letter.verificationCode, deps.verification)
      : null;
    if (numbered && !verification) {
      throw new Error("Set VERIFICATION_HOST or WEB_URL: issued letters print their QR.");
    }
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
      desks: letterDesks(letter, context),
      verification: verification && { ...verification, code: letter.verificationCode as string },
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

  return { render, archive };
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
  readonly pdf: Pick<LetterPdf, "render" | "archive">;
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
}) {
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
    const loaded = await deps.load(letter);
    if (!loaded) return notFound();
    try {
      const bytes =
        letter.status === "issued"
          ? await deps.pdf.archive(letter, loaded.context, loaded.period)
          : await deps.pdf.render(letter, loaded.context, loaded.period);
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
