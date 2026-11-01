import "server-only";
import { z } from "zod";
import type { CertificateAudit, SqlCertificateStore } from "@website/db/sql";
import {
  CERTIFICATE_PICKUP_PURPOSE,
  parseParticipants,
  titleCaseName,
  type Certificate,
  type Letter,
} from "@website/domain/documents";
import { canAccessAdmin, can, type Principal, type ResourceContext } from "@website/permissions";
import { jsonError, verifyLink } from "@website/security";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";
import type { LetterContext, LetterPdf } from "./letter-pdf";

export interface CertificateDeps {
  readonly certificates: Pick<SqlCertificateStore, "add" | "remove">;
  readonly getLetter: (id: string) => Promise<Letter | null>;
  /** keyedHash(CERTIFICATE_EMAIL_PURPOSE, email) with SUBSCRIBER_HASH_SECRET (pickup page). */
  readonly hashEmail: (email: string) => string;
  readonly now: () => Date;
}

const participantAudit =
  (audit: AuditBuilder): CertificateAudit =>
  (batch, change) =>
    audit({
      module: "letters",
      action: "UPDATE",
      resourceType: "letter",
      resourceId: batch.id,
      title: batch.subject,
      before: "removed" in change ? { participant: change.removed } : null,
      after: "added" in change ? { participantsAdded: change.added } : null,
      versionBefore: batch.version,
      versionAfter: batch.version,
      // Sheets are re-added or removed by hand; a revert would reuse numbers and codes.
      revertible: false,
    });

/**
 * Participants of a certificate batch (D5): pasted lists and single removals, for
 * `letters.edit` in the batch's unit, only while the batch can be edited.
 */
export function createCertificateActions(deps: CertificateDeps) {
  const scopeOf = async ({ batchId }: { batchId: string }): Promise<ResourceContext> => ({
    orgUnitPath: (await deps.getLetter(batchId))?.orgUnitPath ?? [],
  });

  const add = createGuardedAction({
    permission: "letters.edit",
    input: z
      .object({ batchId: safeId, text: z.string().max(200_000), titleCase: z.boolean() })
      .strict(),
    resource: scopeOf,
    handler: async ({ batchId, text, titleCase }, _principal, audit) => {
      const people = parseParticipants(text).map((p) => ({
        name: titleCase ? titleCaseName(p.name) : p.name,
        note: p.note,
        emailHash: p.email === null ? null : deps.hashEmail(p.email),
      }));
      const added = await deps.certificates.add(
        batchId,
        people,
        participantAudit(audit),
        deps.now(),
      );
      return { added };
    },
  });

  const remove = createGuardedAction({
    permission: "letters.edit",
    input: z.object({ batchId: safeId, id: safeId }).strict(),
    resource: scopeOf,
    handler: async ({ batchId, id }, _principal, audit) => {
      await deps.certificates.remove(batchId, id, participantAudit(audit));
      return { id };
    },
  });

  return { add, remove };
}

const notFound = () =>
  Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

interface SheetPdfDeps {
  readonly load: (letter: Letter) => Promise<{ context: LetterContext } | null>;
  readonly pdf: Pick<LetterPdf, "renderCertificate">;
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
}

/** One sheet rendered now as a PDF response (never stored), or 404 / a generic 500. */
async function sheetPdf(
  deps: SheetPdfDeps,
  batch: Letter,
  sheet: Certificate,
  disposition: "inline" | "attachment",
): Promise<Response> {
  const loaded = await deps.load(batch);
  if (!loaded) return notFound();
  try {
    const bytes = await deps.pdf.renderCertificate(batch, sheet, loaded.context);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="sertifikat-${String(sheet.seq).padStart(3, "0")}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    deps.logError("certificate pdf failed", {
      batchId: batch.id,
      sheetId: sheet.id,
      error: String(error),
    });
    return jsonError("internal");
  }
}

/**
 * GET /api/letters/<batchId>/certificates/<sheetId>: one sheet, rendered now (D5), for staff
 * who may read the batch (others get 404). Before issue: no number and no QR.
 */
export function createCertificateFileRoute(
  deps: SheetPdfDeps & {
    readonly getLetter: (id: string) => Promise<Letter | null>;
    readonly getSheet: (id: string) => Promise<Certificate | null>;
  },
) {
  return async (batchId: string, sheetId: string, principal: Principal | null) => {
    if (principal === null || !principal.active) return jsonError("unauthenticated");
    if (!canAccessAdmin(principal)) return jsonError("forbidden");
    const [batch, sheet] = await Promise.all([deps.getLetter(batchId), deps.getSheet(sheetId)]);
    if (
      !batch ||
      batch.deletedAt ||
      sheet?.batchId !== batch.id ||
      !can(principal, "letters.read", { orgUnitPath: batch.orgUnitPath })
    ) {
      return notFound();
    }
    return sheetPdf(deps, batch, sheet, "inline");
  };
}

/**
 * GET /certificates/pickup?t=<token>: the holder's own sheet (D5-P), no sign-in. The website's
 * pickup page matched the e-mail and signed a 15-minute link naming the sheet's verification
 * code (LINK_SIGNING_SECRET, the same on web and admin). Only sheets of issued batches; a bad,
 * expired or foreign token is 404.
 */
export function createCertificatePickupRoute(
  deps: SheetPdfDeps & {
    readonly find: (
      code: string,
    ) => Promise<{ letter: Letter; certificate: Certificate | null } | null>;
    readonly secret: () => string | null;
    readonly now: () => Date;
  },
) {
  return async (token: string | null) => {
    const secret = deps.secret();
    const data = token && secret ? verifyLink(token, secret, deps.now()) : null;
    const code = data?.["purpose"] === CERTIFICATE_PICKUP_PURPOSE ? data["code"] : undefined;
    const found = code ? await deps.find(code) : null;
    if (!found?.certificate || found.letter.status !== "issued") return notFound();
    return sheetPdf(deps, found.letter, found.certificate, "attachment");
  };
}
