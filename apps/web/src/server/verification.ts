import "server-only";
import type { FirestoreVerificationReader } from "@website/db/firestore";
import {
  letterCanonical,
  letterVerification,
  normalizeVerificationCode,
  type LetterArchive,
  type LetterVerification,
} from "@website/domain/documents";
import { sha256Hex } from "@website/security";
import { sanitizeRichText } from "@website/security/html";

export interface VerificationDeps {
  readonly reader: Pick<FirestoreVerificationReader, "find">;
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
  ): Promise<LetterVerification | null> => (await check(rawCode, typedName))?.view ?? null;

  /**
   * The archived PDF, under the SAME rule as the content on the page (checked again here: the
   * request can be built by hand). Cancelled letters cannot be downloaded (the archive has no
   * cancelled stamp). A changed archive is never served.
   */
  async function download(rawCode: string, typedName: string | null): Promise<Response> {
    const checked = await check(rawCode, typedName);
    if (!checked?.view.canDownload) return new Response("Not found", { status: 404 });
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
