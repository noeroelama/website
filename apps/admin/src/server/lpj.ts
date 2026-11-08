import "server-only";
import { z } from "zod";
import type { SqlLpjStore } from "@website/db/sql";
import {
  editLpj,
  extendLpjDue,
  formatMoney,
  LPJ_DESK_PERMISSIONS,
  LPJ_DESKS,
  LpjInputSchema,
  returnLpj,
  signLpj,
  submitLpj,
  type LpjDesk,
  type LpjReport,
} from "@website/domain/programs";
import { RuleViolationError } from "@website/domain/shared";
import type { ReportPdfInput } from "@website/pdf";
import {
  can,
  canAccessAdmin,
  type PagePermission,
  type Principal,
  type ResourceContext,
} from "@website/permissions";
import { jsonError } from "@website/security";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction } from "./guarded-action";
import { canManageProgram, lpjAudit } from "./programs";

export interface LpjDeps {
  readonly lpj: Pick<SqlLpjStore, "get" | "transition">;
  readonly afterStep: (lpj: LpjReport) => Promise<void>;
  readonly now: () => Date;
}

export const deskPermission = (desk: LpjDesk) => LPJ_DESK_PERMISSIONS[desk] as PagePermission;

const version = z.number().int().min(1);
const Ref = z.object({ id: safeId, version }).strict();
const SaveLpj = LpjInputSchema.extend({ id: safeId, version }).strict();
const ReturnInput = Ref.extend({ note: safeText(1000, { multiline: true }) }).strict();
const ExtendInput = Ref.extend({ dueOn: z.iso.date() }).strict();

export function createLpjActions(deps: LpjDeps) {
  const scopeOf = async ({ id }: { id: string }): Promise<ResourceContext> => ({
    orgUnitPath: (await deps.lpj.get(id))?.orgUnitPath ?? [],
  });

  const step = <S extends z.ZodType<{ id: string; version: number }>>(
    permission: PagePermission,
    input: S,
    decide: (lpj: LpjReport, input: z.infer<S>, principal: Principal, now: Date) => LpjReport,
  ) =>
    createGuardedAction({
      permission,
      input,
      resource: scopeOf,
      handler: async (parsed, principal, audit) => {
        const now = deps.now();
        const saved = await deps.lpj.transition(
          parsed.id,
          parsed.version,
          (lpj) => decide(lpj, parsed, principal, now),
          lpjAudit(audit, "UPDATE"),
          now,
        );
        await deps.afterStep(saved);
        return { version: saved.version, status: saved.status };
      },
    });

  const asPic = (principal: Principal, lpj: LpjReport) => {
    if (!canManageProgram(principal, lpj)) {
      throw new RuleViolationError("Only the programme's PICs or its unit can write the LPJ.");
    }
  };

  const save = step("programs.read", SaveLpj, (lpj, input, p) => {
    asPic(p, lpj);
    const { realization, obstacles, recommendations, participantCount, realized } = input;
    return editLpj(lpj, { realization, obstacles, recommendations, participantCount, realized });
  });
  const submit = step("programs.read", Ref, (lpj, _input, p, now) => {
    asPic(p, lpj);
    return submitLpj(lpj, p.userId, now);
  });
  const sign = (desk: LpjDesk) =>
    step(deskPermission(desk), Ref, (lpj, _input, p, now) => signLpj(lpj, desk, p.userId, now));
  const returnToPics = step("lpj.read", ReturnInput, (lpj, input, p) => {
    if (!LPJ_DESKS.some((d) => can(p, deskPermission(d), { orgUnitPath: lpj.orgUnitPath }))) {
      throw new RuleViolationError("Only a reviewing desk can return the LPJ.");
    }
    return returnLpj(lpj, input.note);
  });
  const extend = step("programs.approve", ExtendInput, (lpj, input) =>
    extendLpjDue(lpj, input.dueOn),
  );

  return {
    save,
    submit,
    reviewSecretariat: sign("secretariat"),
    reviewTreasurer: sign("treasurer"),
    approve: sign("approval"),
    returnToPics,
    extend,
  };
}

const NOT_REVIEWED = "Belum diperiksa / not yet reviewed";
const day = (date: Date) => date.toISOString().slice(0, 10);

export function lpjSheet(
  lpj: LpjReport,
  names: ReadonlyMap<string, string>,
  now: Date,
): ReportPdfInput {
  const name = (uid: string) => names.get(uid) ?? uid;
  const desk = (label: string, signature: LpjReport["secretariat"]) =>
    `${label}: ${signature ? `${name(signature.uid)}, ${day(signature.at)}` : NOT_REVIEWED}`;
  const plan = lpj.plan;
  return {
    title: "Laporan Pertanggungjawaban (LPJ)",
    subtitle: `${plan.name} · ${plan.unitName}`,
    sections: [
      {
        heading: "Rencana / Plan (as approved)",
        lines: [
          `Tujuan / Goal: ${plan.goal || "-"}`,
          plan.description,
          `Jadwal / Planned: ${[plan.plannedStart, plan.plannedEnd].filter(Boolean).join(" - ") || "-"}`,
          `PIC: ${plan.pics.map(name).join(", ") || "-"}`,
          `Progres / Progress: ${plan.progressPercent}%`,
        ],
      },
      {
        heading: "Milestone",
        lines: plan.milestones.length
          ? plan.milestones.map((m) => `[${m.done ? "x" : " "}] ${m.title} (weight ${m.weight})`)
          : ["-"],
      },
      {
        heading: "Anggaran / Budget (per currency, not converted)",
        lines: [
          `Rencana / Planned: ${plan.budgets.map(formatMoney).join(", ") || "-"}`,
          `Realisasi / Spent: ${lpj.realized === null ? "-" : lpj.realized.map(formatMoney).join(", ") || "0"}`,
        ],
      },
      { heading: "Realisasi kegiatan / Realization", lines: [lpj.realization || "-"] },
      {
        heading: "Peserta / Participants",
        lines: [lpj.participantCount === null ? "-" : String(lpj.participantCount)],
      },
      { heading: "Kendala / Obstacles", lines: [lpj.obstacles || "-"] },
      { heading: "Rekomendasi / Recommendations", lines: [lpj.recommendations || "-"] },
      {
        heading: "Pemeriksaan / Review",
        lines: [
          `Diajukan / Submitted: ${lpj.submittedBy && lpj.submittedAt ? `${name(lpj.submittedBy)}, ${day(lpj.submittedAt)}` : "-"}`,
          desk("Sekretariat / Secretariat", lpj.secretariat),
          desk("Bendahara / Treasurer", lpj.treasurer),
          desk("Persetujuan / Approval", lpj.approval),
        ],
      },
    ],
    footer: `Due ${lpj.dueOn} · revision round ${lpj.revisionRound} · printed ${day(now)} (UTC)`,
  };
}

const notFound = () =>
  Response.json({ error: "not_found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

export function createLpjFileRoute(deps: {
  readonly getLpj: (id: string) => Promise<LpjReport | null>;
  readonly names: (uids: readonly string[]) => Promise<ReadonlyMap<string, string>>;
  readonly render: (input: ReportPdfInput) => Promise<Uint8Array>;
  readonly now: () => Date;
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
}) {
  return async (id: string, principal: Principal | null): Promise<Response> => {
    if (principal === null || !principal.active) return jsonError("unauthenticated");
    if (!canAccessAdmin(principal)) return jsonError("forbidden");
    const lpj = safeId.safeParse(id).success ? await deps.getLpj(id) : null;
    const scope = { orgUnitPath: lpj?.orgUnitPath ?? [] };
    if (!lpj || !(can(principal, "lpj.read", scope) || can(principal, "programs.read", scope))) {
      return notFound();
    }
    try {
      const uids = [...lpj.plan.pics, lpj.submittedBy, ...LPJ_DESKS.map((d) => lpj[d]?.uid)].filter(
        (u): u is string => typeof u === "string",
      );
      const bytes = await deps.render(
        lpjSheet(lpj, await deps.names([...new Set(uids)]), deps.now()),
      );
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="LPJ-${lpj.id}.pdf"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      deps.logError("lpj pdf failed", { lpjId: lpj.id, error: String(error) });
      return jsonError("internal");
    }
  };
}
