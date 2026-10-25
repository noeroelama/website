import "server-only";
import { z } from "zod";
import type { AuditAction } from "@website/audit";
import type {
  FirestoreLetterSettingsStore,
  FirestoreLetterStore,
  FirestoreLetterTypeStore,
  LetterAudit,
} from "@website/db/firestore";
import {
  attachUpload,
  cancelLetter,
  checkUploadedNumber,
  issueUpload,
  letterUploadPath,
  MAX_LETTER_UPLOAD_BYTES,
  placeStamps,
  UploadPlacementSchema,
  LetterheadSchema,
  LetterInputSchema,
  LetterTypeInputSchema,
  passReview,
  returnLetter,
  signDesk,
  submitForReview,
  type Desk,
  type Letter,
  type LetterType,
} from "@website/domain/documents";
import { isPdf, RuleViolationError } from "@website/domain/shared";
import { openPdf, pdfText, type UnreadablePdfError } from "@website/pdf";
import { can, type Permission, type Principal, type ResourceContext } from "@website/permissions";
import { jsonError, readBodyLimited, sha256Hex } from "@website/security";
import { sanitizeRichText } from "@website/security/html";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder, type AuditContext } from "./guarded-action";
import type { LetterPdf } from "./letter-pdf";

export interface LetterDeps {
  readonly letters: Pick<
    FirestoreLetterStore,
    "get" | "create" | "update" | "transition" | "remove" | "issue"
  >;
  readonly types: Pick<FirestoreLetterTypeStore, "save">;
  readonly settings: Pick<FirestoreLetterSettingsStore, "get" | "save">;
  /** After the issue transaction: renders and archives the PDF (errors are logged there; the
   *  preview route archives a letter that has none yet). */
  readonly afterIssue: (letter: Letter) => Promise<void>;
  /** `orgUnitPath` of a unit (unit + ancestors), null when it does not exist. */
  readonly unitPath: (orgUnitId: string) => Promise<readonly string[] | null>;
  /** Upload path (D3): private files, and the stamping shared with the preview. */
  readonly storage: {
    save(
      path: string,
      bytes: Uint8Array,
      options: { visibility: "private"; contentType: "application/pdf" },
    ): Promise<unknown>;
    remove(path: string): Promise<void>;
  };
  readonly files: Pick<LetterPdf, "stampUpload" | "saveFile">;
  readonly now: () => Date;
  readonly uuid: () => string;
}

const Ref = z.object({ id: safeId, version: z.number().int().min(1) }).strict();
const SaveLetter = LetterInputSchema.and(
  z
    .object({
      id: safeId.optional(),
      version: z.number().int().min(1).nullable(),
      /** New letters only: typed here, or the author's own final PDF (D3). Fixed afterwards. */
      source: z.enum(["editor", "upload"]).optional(),
    })
    .strict(),
);
const SaveType = LetterTypeInputSchema.and(
  z.object({ id: safeId.optional(), version: z.number().int().min(1).nullable() }).strict(),
);

const letterAudit =
  (audit: AuditBuilder, action: AuditAction): LetterAudit =>
  (before, after, current, next) =>
    audit({
      module: "letters",
      action,
      resourceType: "letter",
      resourceId: next.id,
      title: next.numberFormatted ?? next.subject,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      // A workflow step (or a number) is never undone by a revert; return or cancel instead.
      revertible: false,
    });

/**
 * Outgoing letters (D1, D2). Scope: an org-unit assignment covers its unit's letters only (and
 * units below it); a global assignment covers every letter. Desk actions are
 * separate permissions: review (secretariat), sign (Secretary-General), sign_coordinator,
 * issue (number), cancel.
 */
export function createLetterActions(deps: LetterDeps) {
  /** The letter's place in the structure, read on the server (never from the input). */
  const scopeOf = async ({ id }: { id: string }): Promise<ResourceContext> => {
    const letter = await deps.letters.get(id);
    return { orgUnitPath: letter?.orgUnitPath ?? [] };
  };
  const unitScope = async (orgUnitId: string): Promise<ResourceContext> => ({
    orgUnitPath: (await deps.unitPath(orgUnitId)) ?? [],
  });

  const clean = <T extends z.infer<typeof LetterInputSchema>>(input: T): T => ({
    ...input,
    body: sanitizeRichText(input.body),
  });

  const save = createGuardedAction({
    permission: "letters.edit",
    input: SaveLetter,
    // New letter: the chosen unit; existing letter: where it is now (the new unit is checked below).
    resource: (input) => (input.id ? scopeOf({ id: input.id }) : unitScope(input.orgUnitId)),
    handler: async ({ id, version, source, ...input }, principal, audit) => {
      const now = deps.now();
      if (id) {
        if (!can(principal, "letters.edit", await unitScope(input.orgUnitId))) {
          throw new RuleViolationError("You can only write letters for your own unit.");
        }
        const saved = await deps.letters.update(
          id,
          version as number,
          clean(input),
          letterAudit(audit, "UPDATE"),
          now,
        );
        return { id: saved.id, version: saved.version };
      }
      const saved = await deps.letters.create(
        clean(input),
        principal.userId,
        letterAudit(audit, "CREATE"),
        now,
        source,
      );
      return { id: saved.id, version: saved.version };
    },
  });

  const step = (
    permission: Permission,
    input: z.ZodType<{ id: string; version: number } & Record<string, unknown>>,
    action: AuditAction,
    decide: (
      letter: Letter,
      type: LetterType,
      input: Record<string, unknown>,
      uid: string,
      now: Date,
    ) => Letter,
  ) =>
    createGuardedAction({
      permission,
      input,
      resource: scopeOf,
      handler: async ({ id, version, ...rest }, principal, audit) => {
        const now = deps.now();
        const saved = await deps.letters.transition(
          id,
          version,
          (letter, type) => decide(letter, type, rest, principal.userId, now),
          letterAudit(audit, action),
          now,
        );
        return { version: saved.version, status: saved.status };
      },
    });

  const sign =
    (desk: Desk) => (letter: Letter, type: LetterType, _: unknown, uid: string, now: Date) =>
      signDesk(letter, type, desk, uid, now);

  const remove = createGuardedAction({
    permission: "letters.edit",
    input: Ref,
    resource: scopeOf,
    handler: async ({ id, version }, _principal, audit) => {
      await deps.letters.remove(id, version, letterAudit(audit, "DELETE"), deps.now());
      return { id };
    },
  });

  const issue = createGuardedAction({
    permission: "letters.issue",
    input: Ref,
    resource: scopeOf,
    handler: async ({ id, version }, _principal, audit) => {
      const { letterhead } = await deps.settings.get();
      const issued = await deps.letters.issue(
        id,
        version,
        letterhead,
        letterAudit(audit, "PUBLISH"),
        deps.now(),
      );
      // The upload path is only numbered here ("Take number"); its file comes later.
      if (issued.status === "issued") await deps.afterIssue(issued);
      return {
        status: issued.status,
        version: issued.version,
        numberFormatted: issued.numberFormatted,
        verificationCode: issued.verificationCode,
      };
    },
  });

  const saveType = createGuardedAction({
    permission: "letter_types.edit",
    input: SaveType,
    handler: async ({ id, version, ...input }, _principal, audit) => {
      const saved = await deps.types.save(
        id ?? null,
        version,
        input,
        (before, after, current, next) =>
          audit({
            module: "letter_types",
            action: current ? "UPDATE" : "CREATE",
            resourceType: "letterType",
            resourceId: next.id,
            title: `${next.code} — ${next.name}`,
            before,
            after,
            versionBefore: current?.version ?? null,
            versionAfter: next.version,
            revertible: false,
          }),
        deps.now(),
      );
      return { id: saved.id, version: saved.version };
    },
  });

  const saveLetterhead = createGuardedAction({
    permission: "letter_types.edit",
    input: z
      .object({ letterhead: LetterheadSchema, version: z.number().int().min(1).nullable() })
      .strict(),
    handler: async ({ letterhead, version }, _principal, audit) => ({
      version: await deps.settings.save(letterhead, version, (before, after, next) =>
        audit({
          module: "letter_types",
          action: "UPDATE",
          resourceType: "letterhead",
          resourceId: "letters",
          title: "Letterhead",
          before,
          after,
          versionBefore: version,
          versionAfter: next,
          revertible: false,
        }),
      ),
    }),
  });

  /** POST /api/letters/<id>/file?version=<n>: the final PDF of an upload letter (≤ 10 MB). */
  const upload = createGuardedAction({
    permission: "letters.edit",
    input: Ref.extend({ request: z.instanceof(Request) }).strict(),
    resource: scopeOf,
    handler: async ({ id, version, request }, principal, audit) => {
      const bytes = await readBodyLimited(request, MAX_LETTER_UPLOAD_BYTES);
      if (bytes === null) throw new RuleViolationError("The PDF may be at most 10 MB.");
      if (!isPdf(bytes)) throw new RuleViolationError("Export the document as a PDF first.");
      const letter = await deps.letters.get(id);
      if (letter?.status !== "awaiting_file") {
        throw new RuleViolationError("This letter is not waiting for its file.");
      }
      // openPdf throws only UnreadablePdfError (locked, damaged, no pages).
      await openPdf(bytes).catch((error: UnreadablePdfError) => {
        throw new RuleViolationError(error.message);
      });
      const numberChecked = checkUploadedNumber(
        await pdfText(bytes),
        letter.numberFormatted as string,
      );
      const now = deps.now();
      const path = letterUploadPath(letter, deps.uuid());
      await deps.storage.save(path, bytes, {
        visibility: "private",
        contentType: "application/pdf",
      });
      const file = {
        path,
        sha256: sha256Hex(bytes),
        size: bytes.length,
        numberChecked,
        uploadedBy: principal.userId,
        uploadedAt: now,
      };
      const saved = await deps.letters.transition(
        id,
        version,
        (current) => attachUpload(current, file),
        letterAudit(audit, "UPLOAD"),
        now,
      );
      if (letter.upload) await deps.storage.remove(letter.upload.path);
      return { version: saved.version, numberChecked };
    },
  });

  /** awaiting_file → issued: the stamped PDF (as previewed) becomes the archive. */
  const issueFile = createGuardedAction({
    permission: "letters.issue",
    input: Ref,
    resource: scopeOf,
    handler: async ({ id, version }, _principal, audit) => {
      const letter = await deps.letters.get(id);
      if (!letter?.upload || letter.version !== version) {
        throw new RuleViolationError("Upload the final PDF first (or reload the page).");
      }
      const stampedFrom = letter.upload.sha256;
      // Refuses an upload whose stored bytes no longer match their checksum.
      const archive = await deps.files.saveFile(letter, await deps.files.stampUpload(letter));
      const now = deps.now();
      const saved = await deps.letters.transition(
        id,
        version,
        (current) => issueUpload(current, archive, stampedFrom, now),
        letterAudit(audit, "PUBLISH"),
        now,
      );
      return { version: saved.version, status: saved.status };
    },
  });

  /** Route form of `upload`: version from the query, body = the PDF. */
  const uploadFile =
    (getPrincipal: () => Promise<Principal | null>, getAuditContext: () => Promise<AuditContext>) =>
    async (id: string, request: Request): Promise<Response> => {
      const version = Number(new URL(request.url).searchParams.get("version"));
      const result = await upload(getPrincipal, getAuditContext)({ id, version, request });
      const noStore = { "Cache-Control": "no-store" };
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

  const Note = Ref.extend({ note: safeText(1000, { multiline: true, allowEmpty: true }) }).strict();
  const Reason = Ref.extend({ reason: safeText(300, { allowEmpty: true }) }).strict();

  return {
    save,
    remove,
    submit: step("letters.edit", Ref, "UPDATE", (letter, type) => submitForReview(letter, type)),
    pass: step("letters.review", Ref, "UPDATE", (letter, type, _input, uid) =>
      passReview(letter, type, uid),
    ),
    returnToDraft: step("letters.review", Note, "UPDATE", (letter, _type, input, uid) =>
      returnLetter(letter, uid, input["note"] as string),
    ),
    signSecretary: step("letters.sign", Ref, "UPDATE", sign("secretary")),
    signCoordinator: step("letters.sign_coordinator", Ref, "UPDATE", sign("coordinator")),
    issue,
    cancel: step("letters.cancel", Reason, "UNPUBLISH", (letter, _type, input, _uid, now) =>
      cancelLetter(letter, input["reason"] as string, now),
    ),
    saveType,
    saveLetterhead,
    upload,
    uploadFile,
    place: step(
      "letters.edit",
      Ref.extend({ placement: UploadPlacementSchema }).strict(),
      "UPDATE",
      (letter, _type, input) =>
        placeStamps(letter, input["placement"] as z.infer<typeof UploadPlacementSchema>),
    ),
    issueFile,
  };
}
