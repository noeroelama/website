import "server-only";
import { z } from "zod";
import type { AuditAction } from "@website/audit";
import type { SqlIncomingStore, IncomingAudit } from "@website/db/sql";
import {
  archiveIncoming,
  completeDisposition,
  dispose,
  DispositionInputSchema,
  IncomingInputSchema,
  MAX_SCAN_BYTES,
  scanPath,
  type IncomingLetter,
} from "@website/domain/documents";
import { isPdf, RuleViolationError } from "@website/domain/shared";
import { can, canAccessAdmin, type Principal } from "@website/permissions";
import { jsonError, readBodyLimited, sha256Hex } from "@website/security";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder, type AuditContext } from "./guarded-action";

export interface IncomingDeps {
  readonly letters: Pick<SqlIncomingStore, "get" | "record" | "update" | "change">;
  /** Period of a unit (null when it does not exist or is deleted). */
  readonly unitPeriod: (orgUnitId: string) => Promise<string | null>;
  readonly userExists: (uid: string) => Promise<boolean>;
  readonly storage: {
    save(
      path: string,
      bytes: Uint8Array,
      options: { visibility: "private"; contentType: "application/pdf" },
    ): Promise<unknown>;
    read(path: string): Promise<Uint8Array | null>;
  };
  readonly now: () => Date;
  readonly uuid: () => string;
}

const Ref = z.object({ id: safeId, version: z.number().int().min(1) }).strict();

const incomingAudit =
  (audit: AuditBuilder, action: AuditAction): IncomingAudit =>
  (before, after, current, next) =>
    audit({
      module: "incoming",
      action,
      resourceType: "incomingLetter",
      resourceId: next.id,
      title: `${next.agendaNumber} — ${next.subject}`,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      // The agenda book is a record of what happened: undone by new steps, never by a revert.
      revertible: false,
    });

/** The browser sends the file name URL-encoded; anything unreadable becomes "scan.pdf". */
function fileName(header: string | null): string {
  try {
    return decodeURIComponent(header ?? "") || "scan.pdf";
  } catch {
    return "scan.pdf";
  }
}

/** Incoming letters page (D6): agenda book (incoming.edit) and dispositions (incoming.dispose). */
export function createIncomingActions(deps: IncomingDeps) {
  const record = createGuardedAction({
    permission: "incoming.edit",
    input: IncomingInputSchema,
    handler: async (input, principal, audit) => {
      const saved = await deps.letters.record(
        input,
        principal.userId,
        incomingAudit(audit, "CREATE"),
        deps.now(),
      );
      return { id: saved.id, version: saved.version, agendaNumber: saved.agendaNumber };
    },
  });

  const update = createGuardedAction({
    permission: "incoming.edit",
    input: IncomingInputSchema.and(Ref),
    handler: async ({ id, version, ...input }, _principal, audit) => {
      const saved = await deps.letters.update(
        id,
        version,
        input,
        incomingAudit(audit, "UPDATE"),
        deps.now(),
      );
      return { version: saved.version };
    },
  });

  const disposeLetter = createGuardedAction({
    permission: "incoming.dispose",
    input: DispositionInputSchema.and(Ref),
    handler: async ({ id, version, ...input }, principal, audit) => {
      const letter = await deps.letters.get(id);
      if (!letter) throw new RuleViolationError("This item does not exist.");
      if (input.toOrgUnitId && (await deps.unitPeriod(input.toOrgUnitId)) !== letter.periodId) {
        throw new RuleViolationError("Choose a unit of this board period.");
      }
      if (input.toUserId && !(await deps.userExists(input.toUserId))) {
        throw new RuleViolationError("No account with this id.");
      }
      const now = deps.now();
      const saved = await deps.letters.change(
        id,
        version,
        (current) => dispose(current, input, principal.userId, deps.uuid(), now),
        incomingAudit(audit, "UPDATE"),
        now,
      );
      return { version: saved.version };
    },
  });

  const complete = createGuardedAction({
    permission: "incoming.dispose",
    input: Ref.extend({
      dispositionId: safeId,
      response: safeText(1000, { multiline: true, allowEmpty: true }),
    }).strict(),
    handler: async ({ id, version, dispositionId, response }, _principal, audit) => {
      const now = deps.now();
      const saved = await deps.letters.change(
        id,
        version,
        (current) => completeDisposition(current, dispositionId, response, now),
        incomingAudit(audit, "UPDATE"),
        now,
      );
      return { version: saved.version, status: saved.status };
    },
  });

  const archive = createGuardedAction({
    permission: "incoming.edit",
    input: Ref,
    handler: async ({ id, version }, _principal, audit) => {
      const saved = await deps.letters.change(
        id,
        version,
        archiveIncoming,
        incomingAudit(audit, "UPDATE"),
        deps.now(),
      );
      return { version: saved.version };
    },
  });

  /** POST /api/incoming/<id>/scan?version=<n>: the letter's scan (PDF ≤ 10 MB, private). */
  const scan = createGuardedAction({
    permission: "incoming.edit",
    input: Ref.extend({ name: safeText(200), request: z.instanceof(Request) }).strict(),
    handler: async ({ id, version, name, request }, _principal, audit) => {
      const bytes = await readBodyLimited(request, MAX_SCAN_BYTES);
      if (bytes === null) throw new RuleViolationError("The scan may be at most 10 MB.");
      if (!isPdf(bytes)) throw new RuleViolationError("Upload the scan as a PDF.");
      const letter = await deps.letters.get(id);
      if (!letter) throw new RuleViolationError("This item does not exist.");
      const path = scanPath(letter.periodId, id, deps.uuid());
      await deps.storage.save(path, bytes, {
        visibility: "private",
        contentType: "application/pdf",
      });
      const file = { path, name, size: bytes.length, sha256: sha256Hex(bytes) };
      const saved = await deps.letters.change(
        id,
        version,
        (current) => {
          if (current.status === "archived")
            throw new RuleViolationError("This letter is archived.");
          return { ...current, scan: file };
        },
        incomingAudit(audit, "UPLOAD"),
        deps.now(),
      );
      return { version: saved.version, name };
    },
  });

  /** GET /api/incoming/<id>/scan: the scan inline, for incoming.read (checksum checked). */
  async function scanFile(id: string, principal: Principal | null): Promise<Response> {
    if (principal === null || !principal.active) return jsonError("unauthenticated");
    if (!canAccessAdmin(principal) || !can(principal, "incoming.read"))
      return jsonError("forbidden");
    const letter: IncomingLetter | null = await deps.letters.get(id);
    const bytes = letter?.scan ? await deps.storage.read(letter.scan.path) : null;
    if (!letter?.scan || !bytes || sha256Hex(bytes) !== letter.scan.sha256) {
      return Response.json(
        { error: "not_found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${letter.agendaNumber.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  /** Route form of `scan`: version and file name from the query/header, body = the PDF. */
  const uploadScan =
    (getPrincipal: () => Promise<Principal | null>, getAuditContext: () => Promise<AuditContext>) =>
    async (id: string, request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const result = await scan(
        getPrincipal,
        getAuditContext,
      )({
        id,
        version: Number(url.searchParams.get("version")),
        name: fileName(request.headers.get("x-file-name")),
        request,
      });
      if (result.ok)
        return Response.json(result.data, {
          status: 201,
          headers: { "Cache-Control": "no-store" },
        });
      if (result.error === "refused" || result.error === "invalid_input") {
        return Response.json(
          { error: "invalid_input", message: result.issues?.[0] },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      }
      return jsonError(
        result.error === "unauthenticated"
          ? "unauthenticated"
          : result.error === "conflict"
            ? "conflict"
            : "forbidden",
      );
    };

  return { record, update, dispose: disposeLetter, complete, archive, uploadScan, scanFile };
}
