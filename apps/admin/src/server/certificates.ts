import "server-only";
import { z } from "zod";
import type { CertificateAudit, SqlCertificateStore, SqlMessageLog } from "@website/db/sql";
import { messageTo, type Contact, type Messenger } from "@website/domain/messaging";
import { RuleViolationError } from "@website/domain/shared";
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

/** Sends per call (each one a provider request; the page calls again for the rest). */
export const SEND_BATCH = 50;

export const certificateSendKey = (batchId: string, seq: number) => `cert:${batchId}:${seq}`;

export interface CertificateSendDeps {
  readonly getLetter: (id: string) => Promise<Letter | null>;
  readonly list: (batchId: string) => Promise<Certificate[]>;
  readonly hashEmail: (email: string) => string;
  /** The account of an e-mail and its WhatsApp number, when there is one. */
  readonly contactOf: (email: string) => Promise<Contact>;
  readonly log: Pick<SqlMessageLog, "byKeys">;
  readonly send: Messenger["send"];
  readonly retry: Messenger["retry"];
  /** The website's pickup page (/certificates). */
  readonly pickupUrl: string;
}

/**
 * Bulk sending (D5): each participant gets a LINK to the pickup page (never the PDF), on WhatsApp
 * when their account has a number, else by e-mail, key `cert:{batchId}:{seq}` (never twice). The
 * e-mails are not stored (only their hash), so staff paste the same list again; lines are matched
 * to sheets by that hash. Only issued batches; a cancelled one cannot be sent.
 */
export function createCertificateSending(deps: CertificateSendDeps) {
  const scopeOf = async ({ batchId }: { batchId: string }): Promise<ResourceContext> => ({
    orgUnitPath: (await deps.getLetter(batchId))?.orgUnitPath ?? [],
  });
  const issued = async (batchId: string) => {
    const batch = await deps.getLetter(batchId);
    if (batch?.status !== "issued" || batch.deletedAt) {
      throw new RuleViolationError("Only an issued certificate batch can be sent.");
    }
    return batch;
  };

  const send = createGuardedAction({
    permission: "letters.edit",
    input: z.object({ batchId: safeId, text: z.string().max(200_000) }).strict(),
    resource: scopeOf,
    handler: async ({ batchId, text }) => {
      const batch = await issued(batchId);
      const sheets = await deps.list(batchId);
      const byHash = new Map(
        sheets.flatMap((c) => (c.emailHash ? [[c.emailHash, c] as const] : [])),
      );
      const lines = parseParticipants(text).filter((p) => p.email !== null);
      const matched = lines.flatMap((p) => {
        const sheet = byHash.get(deps.hashEmail(p.email as string));
        return sheet ? [{ sheet, email: p.email as string }] : [];
      });
      const done = await deps.log.byKeys(
        matched.map((m) => certificateSendKey(batchId, m.sheet.seq)),
      );
      const todo = matched.filter((m) => !done.has(certificateSendKey(batchId, m.sheet.seq)));
      let sent = 0;
      for (const { sheet, email } of todo.slice(0, SEND_BATCH)) {
        const body =
          `Sertifikat "${batch.subject}" untuk ${sheet.name} sudah bisa diunduh. Buka tautan ini dan ` +
          `ketik alamat e-mail ini.\n\nYour certificate "${batch.subject}" is ready. Open this link ` +
          `and type this e-mail address.\n\n${deps.pickupUrl}`;
        await deps.send(
          messageTo(await deps.contactOf(email), {
            subject: `Sertifikat / Certificate: ${batch.subject}`,
            text: body,
            html: `<p>${body.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`).replace(/\n/g, "<br>")}</p>`,
          }),
          certificateSendKey(batchId, sheet.seq),
        );
        sent += 1;
      }
      return {
        sent,
        remaining: todo.length - sent,
        unmatched: lines.length - matched.length,
        withoutEmail: sheets.filter((c) => !c.emailHash).length,
      };
    },
  });

  /** Sends the failed ones again (only those; the same key, so never twice once delivered). */
  const retryFailed = createGuardedAction({
    permission: "letters.edit",
    input: z.object({ batchId: safeId }).strict(),
    resource: scopeOf,
    handler: async ({ batchId }) => {
      await issued(batchId);
      const sheets = await deps.list(batchId);
      const entries = await deps.log.byKeys(sheets.map((c) => certificateSendKey(batchId, c.seq)));
      const failed = [...entries.values()]
        .filter((e) => e.status === "failed")
        .slice(0, SEND_BATCH);
      for (const entry of failed) await deps.retry(entry.id);
      return { retried: failed.length };
    },
  });

  /** Progress: per status how many sheets (not sent = no log entry yet). */
  async function progress(batchId: string): Promise<Record<string, number>> {
    const sheets = await deps.list(batchId);
    const entries = await deps.log.byKeys(sheets.map((c) => certificateSendKey(batchId, c.seq)));
    const counts: Record<string, number> = { not_sent: 0 };
    for (const sheet of sheets) {
      const status = entries.get(certificateSendKey(batchId, sheet.seq))?.status ?? "not_sent";
      counts[status] = (counts[status] ?? 0) + 1;
    }
    return counts;
  }

  return { send, retryFailed, progress };
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
