import "server-only";
import { z } from "zod";
import type { SqlVerificationReader } from "@website/db/sql";
import {
  certificateVerification,
  letterCanonical,
  letterVerification,
  normalizeVerificationCode,
  type CertificateVerification,
  type LetterArchive,
  type LetterVerification,
  sheetNumber,
} from "@website/domain/documents";
import { NewsletterEmailSchema } from "@website/domain/newsletter";
import { sha256Hex } from "@website/security";
import { sanitizeRichText } from "@website/security/html";

export interface VerificationDeps {
  readonly reader: Pick<SqlVerificationReader, "find">;
  /** Private Storage read (archived PDFs). */
  readonly readFile: (path: string) => Promise<Uint8Array | null>;
}

const MAX_NAME = 200;

/**
 * Public verification (D7): /verify/<code> on the website and the bare /<CODE> on the
 * verification host. No sign-in; nothing but the public DTO leaves the server.
 */
export function createVerification(deps: VerificationDeps) {
  async function check(rawCode: string, typedName: string | null) {
    const code = normalizeVerificationCode(rawCode);
    if (!code) return null;
    const found = await deps.reader.find(code);
    if (!found) return null;
    const { letter, type } = found;
    if (found.certificate) {
      // A certificate sheet (D5): no content gate and no file here (the pickup page has them).
      const view = certificateVerification({
        code,
        batch: letter,
        certificate: found.certificate,
        unitName: found.unitName,
        periodName: found.periodName,
      });
      return { view, archive: null };
    }
    const digestMatches =
      letter.contentDigest === null
        ? null
        : sha256Hex(new TextEncoder().encode(letterCanonical(letter, type.code))) ===
          letter.contentDigest;
    const result = letterVerification({
      code,
      letter,
      typeName: type.name,
      contentPublic: type.contentPublic,
      unitName: found.unitName,
      periodName: found.periodName,
      digestMatches,
      typedName: typedName === null ? null : typedName.slice(0, MAX_NAME),
    });
    return {
      // Sanitized again when shown (it was sanitized when saved).
      view:
        result.bodyHtml === null
          ? result
          : { ...result, bodyHtml: sanitizeRichText(result.bodyHtml) },
      archive: letter.archive,
    };
  }

  const view = async (
    rawCode: string,
    typedName: string | null,
  ): Promise<LetterVerification | CertificateVerification | null> =>
    (await check(rawCode, typedName))?.view ?? null;

  /**
   * The archived PDF, under the SAME rule as the content on the page (checked again here: the
   * request can be built by hand). Cancelled letters cannot be downloaded (the archive has no
   * cancelled stamp). A changed archive is never served.
   */
  async function download(rawCode: string, typedName: string | null): Promise<Response> {
    const checked = await check(rawCode, typedName);
    if (checked?.view.kind !== "letter" || !checked.view.canDownload) {
      return new Response("Not found", { status: 404 });
    }
    // canDownload implies an archive.
    const { view: result } = checked;
    const archive = checked.archive as LetterArchive;
    const bytes = await deps.readFile(archive.path);
    if (!bytes || sha256Hex(bytes) !== archive.sha256) {
      return new Response(null, {
        status: 303,
        headers: { Location: `/verify/${result.code}?archive=damaged` },
      });
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${result.number.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return { view, download };
}

export interface PickupSheet {
  readonly number: string;
  readonly holderName: string;
  readonly note: string | null;
  readonly activity: string;
  readonly letterDate: string | null;
  /** The 15-minute signed download link (admin /certificates/pickup). */
  readonly href: string;
}

export type PickupResult =
  | { readonly ok: true; readonly sheets: readonly PickupSheet[] }
  | { readonly ok: false; readonly error: "email" | "captcha" };

const PickupInput = z
  .object({ email: NewsletterEmailSchema, captcha: z.string().max(4000) })
  .strict();

/**
 * Certificate pickup (D5-P, /certificates): the e-mail given at registration, matched EXACTLY
 * through its keyed hash (no lists, no partial search). Only sheets of issued batches; each
 * comes with a short signed download link. reCAPTCHA here, the tighter per-IP limit in the
 * request guard.
 */
export function createCertificatePickup(deps: {
  readonly reader: Pick<SqlVerificationReader, "certificatesByEmailHash">;
  readonly captcha: (token: string) => Promise<boolean>;
  /** keyedHash(CERTIFICATE_EMAIL_PURPOSE, email, SUBSCRIBER_HASH_SECRET). */
  readonly hashEmail: (email: string) => string;
  /** The signed download link of the sheet with this verification code. */
  readonly link: (code: string) => string;
}) {
  async function lookup(input: unknown): Promise<PickupResult> {
    const parsed = PickupInput.safeParse(input);
    if (!parsed.success) return { ok: false, error: "email" };
    if (!(await deps.captcha(parsed.data.captcha))) return { ok: false, error: "captcha" };
    const found = await deps.reader.certificatesByEmailHash(deps.hashEmail(parsed.data.email));
    return {
      ok: true,
      sheets: found.map(({ letter, certificate }) => ({
        number: sheetNumber(letter.sheetNumberTemplate, certificate.seq) ?? "",
        holderName: certificate.name,
        note: certificate.note,
        activity: letter.subject,
        letterDate: letter.letterDate,
        href: deps.link(certificate.verificationCode),
      })),
    };
  }
  return { lookup };
}
