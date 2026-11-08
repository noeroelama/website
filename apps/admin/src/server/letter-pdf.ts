import "server-only";
import type { SqlLetterStore, SqlSignatureStore } from "@website/db/sql";
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
  readonly letters: Pick<SqlLetterStore, "setArchive">;
  readonly toPng: (bytes: Uint8Array) => Promise<Uint8Array>;
  readonly verification: { readonly host: string | null; readonly webUrl: string | null };
  readonly uuid: () => string;
  readonly signatures: Pick<SqlSignatureStore, "get">;
  readonly signatureKey: () => string | null;
}

type PrintedSignature = LetterDesk["signature"];

export interface LetterContext {
  readonly type: LetterType;
  readonly unitName: string;
  readonly names: ReadonlyMap<string, string>;
  readonly letterhead: Letterhead;
}

export class ArchiveDamagedError extends Error {
  override readonly name = "ArchiveDamagedError";
}

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
    const frozen = letter.signers.find((s) => s.desk === label && signature !== null);
    return {
      label,
      name: frozen?.name ?? (signature ? (context.names.get(signature.uid) ?? null) : null),
      signedOn: signature ? formatLetterDate(signature.at) : null,
      signature: signature ? (signatures.get(signature.uid) ?? null) : null,
    };
  });
}

export function createLetterPdf(deps: LetterPdfDeps) {
  const image = async (art: LetterheadImage | null): Promise<PdfImage | null> => {
    if (!art) return null;
    const bytes = await deps.storage.read(art.path);
    return bytes ? { bytes: await deps.toPng(bytes), type: "png" } : null;
  };

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

  function verificationOf(code: string | null) {
    if (code === null) return null;
    const verification = verificationUrl(code, deps.verification);
    if (!verification) {
      throw new Error("Set VERIFICATION_HOST or WEB_URL: issued letters print their QR.");
    }
    return { ...verification, code };
  }

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
    return stored.path === path ? bytes : archive({ ...letter, archive: stored }, context, period);
  }

  async function stampUpload(letter: Letter): Promise<Uint8Array> {
    const upload = letter.upload;
    const bytes = upload ? await deps.storage.read(upload.path) : null;
    if (!upload || !bytes || sha256Hex(bytes) !== upload.sha256) {
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
    const verification = verificationOf(letter.verificationCode) as NonNullable<
      ReturnType<typeof verificationOf>
    >;
    return stampPdf(bytes, { signatures, qr: qr && { spot: qr, ...qr, ...verification } });
  }

  async function saveFile(letter: Letter, bytes: Uint8Array): Promise<LetterArchive> {
    const path = letterArchivePath(letter, deps.uuid());
    await deps.storage.save(path, bytes, { visibility: "private", contentType: "application/pdf" });
    return { path, sha256: sha256Hex(bytes), size: bytes.length };
  }

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

export function createLetterFileRoute(deps: {
  readonly getLetter: (id: string) => Promise<Letter | null>;
  readonly load: (
    letter: Letter,
  ) => Promise<{ context: LetterContext; period: string | null } | null>;
  readonly pdf: Pick<LetterPdf, "render" | "archive" | "stampUpload">;
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
}) {
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
