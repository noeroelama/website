import "server-only";
import { z } from "zod";
import type { AuditAction } from "@website/audit";
import type { FinanceAudit, SqlFinanceStore } from "@website/db/sql";
import {
  attachDocument,
  authorizeRequest,
  completeRequest,
  financeFilePath,
  FinanceRequestInputSchema,
  markPaid,
  MAX_FINANCE_FILE_BYTES,
  rejectRequest,
  removeDocument,
  returnRequest,
  reviewRequest,
  submitRequest,
  type FinanceDesk,
  type FinanceFile,
  type FinanceRequest,
} from "@website/domain/finance";
import { isPdf, RuleViolationError } from "@website/domain/shared";
import {
  can,
  canAccessAdmin,
  type Permission,
  type Principal,
  type ResourceContext,
} from "@website/permissions";
import { jsonError, readBodyLimited, sha256Hex } from "@website/security";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder, type AuditContext } from "./guarded-action";

export interface FinanceDeps {
  readonly requests: Pick<SqlFinanceStore, "get" | "create" | "update" | "remove" | "change">;
  /** `orgUnitPath` of a unit (unit + ancestors), null when it does not exist. */
  readonly unitPath: (orgUnitId: string) => Promise<readonly string[] | null>;
  readonly storage: {
    save(
      path: string,
      bytes: Uint8Array,
      options: { visibility: "private"; contentType: "application/pdf" },
    ): Promise<unknown>;
    read(path: string): Promise<Uint8Array | null>;
  };
  /** After a step committed: tells whoever acts next (J2; never throws). */
  readonly afterStep: (request: FinanceRequest) => Promise<void>;
  readonly now: () => Date;
  readonly uuid: () => string;
}

const Ref = z.object({ id: safeId, version: z.number().int().min(1) }).strict();
const Note = Ref.extend({ note: safeText(1000, { multiline: true, allowEmpty: true }) }).strict();
const SaveRequest = FinanceRequestInputSchema.and(
  z.object({ id: safeId.optional(), version: z.number().int().min(1).nullable() }).strict(),
);
const noStore = { "Cache-Control": "no-store" };

const financeAudit =
  (audit: AuditBuilder, action: AuditAction): FinanceAudit =>
  (before, after, current, next) =>
    audit({
      module: "finance",
      action,
      resourceType: "financeRequest",
      resourceId: next.id,
      title: next.title,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      // A desk step is undone by a return or a new request, never by a revert.
      revertible: false,
    });

/** The browser sends the file name URL-encoded; anything unreadable becomes "document.pdf". */
function fileName(header: string | null): string {
  try {
    return decodeURIComponent(header ?? "").slice(0, 200) || "document.pdf";
  } catch {
    return "document.pdf";
  }
}

/**
 * Finance requests (I1). Scope: an org-unit assignment covers its unit's requests (and units
 * below); a global one every request. Desks are separate permissions: review (treasurer),
 * authorize (coordinator), pay (marks the transfer with its proof).
 */
export function createFinanceActions(deps: FinanceDeps) {
  /** The request's place in the structure, read on the server (never from the input). */
  const scopeOf = async ({ id }: { id: string }): Promise<ResourceContext> => ({
    orgUnitPath: (await deps.requests.get(id))?.orgUnitPath ?? [],
  });
  const unitScope = async (orgUnitId: string): Promise<ResourceContext> => ({
    orgUnitPath: (await deps.unitPath(orgUnitId)) ?? [],
  });

  const save = createGuardedAction({
    permission: "finance.edit",
    input: SaveRequest,
    // New request: the chosen unit; existing one: where it is now (the new unit is checked below).
    resource: (input) => (input.id ? scopeOf({ id: input.id }) : unitScope(input.orgUnitId)),
    handler: async ({ id, version, ...input }, principal, audit) => {
      const now = deps.now();
      if (id) {
        if (!can(principal, "finance.edit", await unitScope(input.orgUnitId))) {
          throw new RuleViolationError("You can only make requests for your own unit.");
        }
        const saved = await deps.requests.update(
          id,
          version as number,
          input,
          financeAudit(audit, "UPDATE"),
          now,
        );
        return { id: saved.id, version: saved.version };
      }
      const saved = await deps.requests.create(
        input,
        principal.userId,
        financeAudit(audit, "CREATE"),
        now,
      );
      return { id: saved.id, version: saved.version };
    },
  });

  const remove = createGuardedAction({
    permission: "finance.edit",
    input: Ref,
    resource: scopeOf,
    handler: async ({ id, version }, _principal, audit) => {
      await deps.requests.remove(id, version, financeAudit(audit, "DELETE"), deps.now());
      return { id };
    },
  });

  const step = <S extends z.ZodType<{ id: string; version: number }>>(
    permission: Permission,
    input: S,
    decide: (request: FinanceRequest, input: z.infer<S>, uid: string, now: Date) => FinanceRequest,
  ) =>
    createGuardedAction({
      permission,
      input,
      resource: scopeOf,
      handler: async (parsed, principal, audit) => {
        const now = deps.now();
        const saved = await deps.requests.change(
          parsed.id,
          parsed.version,
          (request) => decide(request, parsed, principal.userId, now),
          financeAudit(audit, "UPDATE"),
          now,
        );
        await deps.afterStep(saved);
        return { version: saved.version, status: saved.status };
      },
    });

  const deskPermission = { treasurer: "finance.review", coordinator: "finance.authorize" } as const;
  const sendBack = (desk: FinanceDesk) =>
    step(deskPermission[desk], Note, (r, { note }, uid) => returnRequest(r, desk, uid, note));
  const reject = (desk: FinanceDesk) =>
    step(deskPermission[desk], Note, (r, { note }, uid, now) =>
      rejectRequest(r, desk, uid, note, now),
    );

  const removeFile = step(
    "finance.edit",
    Ref.extend({ path: z.string().max(300) }).strict(),
    (r, { path }) => removeDocument(r, path),
  );

  /** Reads a PDF body (≤ 10 MB) and stores it privately for the request. */
  const storePdf = async (
    request: Request,
    current: FinanceRequest,
    kind: "doc" | "proof",
    name: string,
  ): Promise<FinanceFile> => {
    const bytes = await readBodyLimited(request, MAX_FINANCE_FILE_BYTES);
    if (bytes === null) throw new RuleViolationError("The PDF may be at most 10 MB.");
    if (!isPdf(bytes)) throw new RuleViolationError("Upload the file as a PDF.");
    const path = financeFilePath(current, kind, deps.uuid());
    await deps.storage.save(path, bytes, { visibility: "private", contentType: "application/pdf" });
    return { path, name, size: bytes.length, sha256: sha256Hex(bytes) };
  };

  const existing = async (id: string) => {
    const request = await deps.requests.get(id);
    if (!request) throw new RuleViolationError("This item does not exist.");
    return request;
  };

  const Upload = Ref.extend({ name: safeText(200), request: z.instanceof(Request) }).strict();

  /** POST /api/finance/<id>/files?kind=doc: a required document (proposal, RAB, receipts). */
  const uploadDocument = createGuardedAction({
    permission: "finance.edit",
    input: Upload,
    resource: scopeOf,
    handler: async ({ id, version, name, request }, _principal, audit) => {
      const file = await storePdf(request, await existing(id), "doc", name);
      const saved = await deps.requests.change(
        id,
        version,
        (current) => attachDocument(current, file),
        financeAudit(audit, "UPLOAD"),
        deps.now(),
      );
      return { version: saved.version, name };
    },
  });

  /** POST /api/finance/<id>/files?kind=proof&amount=<minor>: marks paid with the proof. */
  const pay = createGuardedAction({
    permission: "finance.pay",
    input: Upload.extend({ amountMinor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }),
    resource: scopeOf,
    handler: async ({ id, version, name, request, amountMinor }, principal, audit) => {
      const current = await existing(id);
      // Refused before the file is stored (status, requester), and again in the transaction.
      markPaid(
        current,
        principal.userId,
        amountMinor,
        { path: "", name, size: 0, sha256: "" },
        deps.now(),
      );
      const proof = await storePdf(request, current, "proof", name);
      const now = deps.now();
      const saved = await deps.requests.change(
        id,
        version,
        (r) => markPaid(r, principal.userId, amountMinor, proof, now),
        financeAudit(audit, "UPDATE"),
        now,
      );
      await deps.afterStep(saved);
      return { version: saved.version, status: saved.status };
    },
  });

  /** Route form of the uploads: version, kind and amount from the query, body = the PDF. */
  const uploadFile =
    (getPrincipal: () => Promise<Principal | null>, getAuditContext: () => Promise<AuditContext>) =>
    async (id: string, request: Request): Promise<Response> => {
      const query = new URL(request.url).searchParams;
      const input = {
        id,
        version: Number(query.get("version")),
        name: fileName(request.headers.get("x-file-name")),
        request,
      };
      const result =
        query.get("kind") === "proof"
          ? await pay(
              getPrincipal,
              getAuditContext,
            )({
              ...input,
              amountMinor: Number(query.get("amount")),
            })
          : await uploadDocument(getPrincipal, getAuditContext)(input);
      if (result.ok) return Response.json(result.data, { status: 201, headers: noStore });
      if (result.error === "refused" || result.error === "invalid_input") {
        return Response.json(
          { error: "invalid_input", message: result.issues?.[0] },
          { status: 400, headers: noStore },
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

  /** GET /api/finance/<id>/files?path=…: a document or the proof, for finance.read in scope. */
  async function readFile(id: string, path: string, principal: Principal | null) {
    if (principal === null || !principal.active) return jsonError("unauthenticated");
    const request = await deps.requests.get(id);
    if (
      !canAccessAdmin(principal) ||
      !can(principal, "finance.read", { orgUnitPath: request?.orgUnitPath ?? [] })
    ) {
      return jsonError("forbidden");
    }
    const file = [...(request?.documents ?? []), request?.payment?.proof].find(
      (f) => f?.path === path,
    );
    const bytes = file ? await deps.storage.read(file.path) : null;
    if (!file || !bytes || sha256Hex(bytes) !== file.sha256) {
      return Response.json({ error: "not_found" }, { status: 404, headers: noStore });
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${file.name.replace(/[^A-Za-z0-9._-]+/g, "-")}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  return {
    save,
    remove,
    submit: step("finance.edit", Ref, (r, _input, _uid, now) => submitRequest(r, now)),
    review: step("finance.review", Note, (r, { note }, uid, now) =>
      reviewRequest(r, uid, note, now),
    ),
    authorize: step("finance.authorize", Note, (r, { note }, uid, now) =>
      authorizeRequest(r, uid, note, now),
    ),
    returnAsTreasurer: sendBack("treasurer"),
    returnAsCoordinator: sendBack("coordinator"),
    rejectAsTreasurer: reject("treasurer"),
    rejectAsCoordinator: reject("coordinator"),
    complete: step("finance.edit", Ref, (r, _input, _uid, now) => completeRequest(r, now)),
    removeFile,
    uploadFile,
    readFile,
  };
}
