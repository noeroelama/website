import "server-only";
import { z } from "zod";
import type { AuditAction } from "@website/audit";
import type { CashAudit, FinanceAudit, SqlFinanceStore } from "@website/db/sql";
import {
  attachDocument,
  authorizeRequest,
  CASH_CATEGORY_LABELS,
  CashEntryInputSchema,
  cashReport,
  completeRequest,
  financeFilePath,
  FinanceRequestInputSchema,
  markPaid,
  MAX_FINANCE_FILE_BYTES,
  rejectRequest,
  removeDocument,
  ReportRangeSchema,
  returnRequest,
  reviewRequest,
  submitRequest,
  type FinanceDesk,
  type FinanceFile,
  type FinanceRequest,
  type CurrencyReport,
} from "@website/domain/finance";
import { formatMoney, isPdf, majorText, RuleViolationError } from "@website/domain/shared";
import { renderTablePdf } from "@website/pdf";
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
  readonly requests: Pick<
    SqlFinanceStore,
    "get" | "create" | "update" | "remove" | "change" | "pay" | "addEntry" | "listEntries"
  >;
  readonly period: () => Promise<{ readonly id: string; readonly name: string } | null>;
  readonly logExport: (actorId: string, details: Record<string, unknown>) => void;
  readonly programPeriod: (programId: string) => Promise<string | null>;
  readonly unitPath: (orgUnitId: string) => Promise<readonly string[] | null>;
  readonly storage: {
    save(
      path: string,
      bytes: Uint8Array,
      options: { visibility: "private"; contentType: "application/pdf" },
    ): Promise<unknown>;
    read(path: string): Promise<Uint8Array | null>;
  };
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

const cashAudit =
  (audit: AuditBuilder): CashAudit =>
  (after, entry) =>
    audit({
      module: "finance",
      action: "CREATE",
      resourceType: "cashEntry",
      resourceId: entry.id,
      title: `${entry.description} (${formatMoney(entry)})`,
      before: null,
      after,
      versionBefore: null,
      versionAfter: 1,
      revertible: false,
    });

const cell = (value: string) =>
  `"${(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`;

const CSV_HEADER = "currency,date,kind,category,description,in,out,balance,source";

function reportCsv(report: readonly CurrencyReport[], from: string | null, to: string | null) {
  const lines = [CSV_HEADER];
  for (const r of report) {
    const m = (amount: number) => majorText(amount, r.currency);
    lines.push(
      `${r.currency},${from ?? ""},opening,,${cell("Opening balance")},,,${m(r.opening)},`,
    );
    for (const { entry, balance } of r.rows) {
      const amount = m(entry.amountMinor);
      lines.push(
        [
          r.currency,
          entry.date,
          entry.kind,
          entry.category,
          cell(entry.description),
          entry.kind === "in" ? amount : "",
          entry.kind === "out" ? amount : "",
          m(balance),
          entry.source,
        ].join(","),
      );
    }
    lines.push(
      `${r.currency},${to ?? ""},closing,,${cell("Closing balance")},${m(r.totalIn)},${m(r.totalOut)},${m(r.closing)},`,
    );
  }
  return "\ufeff" + lines.join("\r\n") + "\r\n";
}

function reportPdf(
  report: readonly CurrencyReport[],
  period: string,
  from: string | null,
  to: string | null,
  now: Date,
) {
  return renderTablePdf({
    title: "Laporan Kas / Cash report",
    lines: [
      `PPIDK Asia-Oseania · ${period}`,
      `${from ?? "start"} – ${to ?? "today"} · made ${now.toISOString().slice(0, 16).replace("T", " ")} UTC`,
    ],
    columns: [
      { header: "Date", width: 0.13 },
      { header: "Category", width: 0.15 },
      { header: "Description", width: 0.3 },
      { header: "In", width: 0.14, align: "right" },
      { header: "Out", width: 0.14, align: "right" },
      { header: "Balance", width: 0.14, align: "right" },
    ],
    sections: report.map((r) => {
      const m = (amount: number) => majorText(amount, r.currency);
      const money = (amountMinor: number) => formatMoney({ amountMinor, currency: r.currency });
      return {
        heading: r.currency,
        rows: r.rows.map(({ entry, balance }) => [
          entry.date,
          CASH_CATEGORY_LABELS[entry.category],
          entry.description,
          entry.kind === "in" ? m(entry.amountMinor) : "",
          entry.kind === "out" ? m(entry.amountMinor) : "",
          m(balance),
        ]),
        summary: [
          `Opening balance: ${money(r.opening)}`,
          `In: ${money(r.totalIn)} · Out: ${money(r.totalOut)}`,
          `Closing balance: ${money(r.closing)}`,
        ],
      };
    }),
    empty: "No cash book entries in this range.",
  });
}

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
      revertible: false,
    });

function fileName(header: string | null): string {
  try {
    return decodeURIComponent(header ?? "").slice(0, 200) || "document.pdf";
  } catch {
    return "document.pdf";
  }
}

export function createFinanceActions(deps: FinanceDeps) {
  const scopeOf = async ({ id }: { id: string }): Promise<ResourceContext> => ({
    orgUnitPath: (await deps.requests.get(id))?.orgUnitPath ?? [],
  });
  const unitScope = async (orgUnitId: string): Promise<ResourceContext> => ({
    orgUnitPath: (await deps.unitPath(orgUnitId)) ?? [],
  });

  const save = createGuardedAction({
    permission: "finance.edit",
    input: SaveRequest,
    resource: (input) => (input.id ? scopeOf({ id: input.id }) : unitScope(input.orgUnitId)),
    handler: async ({ id, version, ...input }, principal, audit) => {
      const now = deps.now();
      const period = await deps.period();
      if (input.programId && period && (await deps.programPeriod(input.programId)) !== period.id) {
        throw new RuleViolationError("The programme is not one of the active period.");
      }
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

  const pay = createGuardedAction({
    permission: "finance.pay",
    input: Upload.extend({ amountMinor: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }),
    resource: scopeOf,
    handler: async ({ id, version, name, request, amountMinor }, principal, audit) => {
      const current = await existing(id);
      markPaid(
        current,
        principal.userId,
        amountMinor,
        { path: "", name, size: 0, sha256: "" },
        deps.now(),
      );
      const proof = await storePdf(request, current, "proof", name);
      const now = deps.now();
      const saved = await deps.requests.pay(
        id,
        version,
        (r) => markPaid(r, principal.userId, amountMinor, proof, now),
        financeAudit(audit, "UPDATE"),
        cashAudit(audit),
        now,
      );
      await deps.afterStep(saved);
      return { version: saved.version, status: saved.status };
    },
  });

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

  const addCashEntry = createGuardedAction({
    permission: "finance.cashbook",
    input: CashEntryInputSchema,
    handler: async (input, principal, audit) => {
      const entry = await deps.requests.addEntry(
        input,
        principal.userId,
        cashAudit(audit),
        deps.now(),
      );
      return { id: entry.id };
    },
  });

  async function reportFile(url: URL, principal: Principal | null): Promise<Response> {
    if (principal === null || !principal.active) return jsonError("unauthenticated");
    if (!canAccessAdmin(principal) || !can(principal, "finance.export")) {
      return jsonError("forbidden");
    }
    const query = url.searchParams;
    const range = ReportRangeSchema.safeParse({
      from: query.get("from") || null,
      to: query.get("to") || null,
    });
    if (!range.success) {
      return Response.json(
        { error: "invalid_input", message: range.error.issues[0]?.message },
        { status: 400, headers: noStore },
      );
    }
    const period = await deps.period();
    if (!period) return Response.json({ error: "not_found" }, { status: 404, headers: noStore });
    const { from, to } = range.data;
    const report = cashReport(await deps.requests.listEntries(period.id), range.data);
    const format = query.get("format") === "pdf" ? "pdf" : "csv";
    deps.logExport(principal.userId, { dataset: "cash_report", format, from, to });
    const name = `cash-report-${from ?? "start"}-${to ?? "now"}.${format}`;
    const headers = {
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };
    if (format === "csv") {
      return new Response(reportCsv(report, from, to), {
        headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
      });
    }
    const bytes = await reportPdf(report, period.name, from, to, deps.now());
    return new Response(new Uint8Array(bytes), {
      headers: { ...headers, "Content-Type": "application/pdf" },
    });
  }

  return {
    addCashEntry,
    reportFile,
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
