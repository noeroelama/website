import "server-only";
import { z } from "zod";
import type { CertificateAudit, FirestoreCertificateStore } from "@website/db/firestore";
import {
  parseParticipants,
  titleCaseName,
  type Certificate,
  type Letter,
} from "@website/domain/documents";
import { canAccessAdmin, can, type Principal, type ResourceContext } from "@website/permissions";
import { jsonError } from "@website/security";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";
import type { LetterContext, LetterPdf } from "./letter-pdf";

export interface CertificateDeps {
  readonly certificates: Pick<FirestoreCertificateStore, "add" | "remove">;
  readonly getLetter: (id: string) => Promise<Letter | null>;
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
      const people = parseParticipants(text).map((p) =>
        titleCase ? { ...p, name: titleCaseName(p.name) } : p,
      );
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

/**
 * GET /api/letters/<batchId>/certificates/<sheetId>: one sheet, rendered now (D5), for staff
 * who may read the batch (others get 404). Before issue: no number and no QR.
 */
export function createCertificateFileRoute(deps: {
  readonly getLetter: (id: string) => Promise<Letter | null>;
  readonly getSheet: (id: string) => Promise<Certificate | null>;
  readonly load: (letter: Letter) => Promise<{ context: LetterContext } | null>;
  readonly pdf: Pick<LetterPdf, "renderCertificate">;
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
}) {
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
    const loaded = await deps.load(batch);
    if (!loaded) return notFound();
    try {
      const bytes = await deps.pdf.renderCertificate(batch, sheet, loaded.context);
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="sertifikat-${String(sheet.seq).padStart(3, "0")}.pdf"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      deps.logError("certificate pdf failed", { batchId, sheetId, error: String(error) });
      return jsonError("internal");
    }
  };
}
