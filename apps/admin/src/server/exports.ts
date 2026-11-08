import "server-only";
import { z } from "zod";
import { formatMoney, PROGRAM_STATUSES, type PeriodReportCard } from "@website/domain/programs";
import type { ReportPdfInput } from "@website/pdf";
import {
  canAccessAdmin,
  canInSomeScope,
  type Permission,
  type Principal,
} from "@website/permissions";
import { jsonError } from "@website/security";
import { label, PROGRAM_STATUS_LABELS } from "../labels";
import { createGuardedAction } from "./guarded-action";

const printed = (now: Date) => `Printed ${now.toISOString().slice(0, 16).replace("T", " ")} UTC`;

export function reportCardSheet(
  card: PeriodReportCard,
  periodName: string,
  unitName: ReadonlyMap<string, string>,
  now: Date,
): ReportPdfInput {
  const { okr, programmes, budget, lpj } = card;
  return {
    title: `Rapor periode / Report card: ${periodName}`,
    subtitle: "Computed at print time, never stored",
    sections: [
      {
        heading: "Summary",
        lines: [
          `OKR achievement: ${okr.achievementPercent}%`,
          `Programme completion: ${programmes.completionPercent}%`,
          `Programmes at risk: ${programmes.troubled}`,
        ],
      },
      {
        heading: "Programmes",
        lines: [
          `${PROGRAM_STATUSES.map((s) => `${label(PROGRAM_STATUS_LABELS, s)}: ${programmes.counts[s]}`).join(" · ")} · Total: ${programmes.total}`,
          `LPJ waiting for review: ${lpj.submitted} · approved: ${lpj.approved} · overdue: ${lpj.overdue}`,
        ],
      },
      {
        heading: "Budget absorption (per currency, spent = approved LPJs)",
        lines: budget.length
          ? budget.map(
              (b) =>
                `${b.currency}: planned ${formatMoney(b.planned)}, spent ${formatMoney(b.realized)}, absorption ${b.absorptionPercent === null ? "—" : `${b.absorptionPercent}%`}`,
            )
          : ["No budget lines yet."],
      },
      {
        heading: "OKR",
        lines: okr.objectives.length
          ? okr.objectives.map(
              (o) =>
                `${o.title} (${o.orgUnitId ? (unitName.get(o.orgUnitId) ?? "") : "Region"}): ${o.percent}% · ${o.keyResults} key results`,
            )
          : ["No objectives yet."],
      },
    ],
    footer: printed(now),
  };
}

export function createReportCardFileRoute(deps: {
  periods: () => Promise<ReadonlyArray<{ id: string; name: string; status: string }>>;
  card: (periodId: string) => Promise<PeriodReportCard>;
  units: (periodId: string) => Promise<ReadonlyArray<{ id: string; name: string }>>;
  render: (input: ReportPdfInput) => Promise<Uint8Array>;
  now: () => Date;
}) {
  return async (periodId: string | null, principal: Principal | null): Promise<Response> => {
    if (principal === null || !principal.active) return jsonError("unauthenticated");
    if (!canAccessAdmin(principal) || !canInSomeScope(principal, "programs.read")) {
      return jsonError("forbidden");
    }
    const periods = await deps.periods();
    const period =
      periods.find((p) => p.id === periodId) ??
      periods.find((p) => p.status === "active") ??
      periods[0];
    if (!period) {
      return Response.json(
        { error: "not_found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    const [card, units] = await Promise.all([deps.card(period.id), deps.units(period.id)]);
    const bytes = await deps.render(
      reportCardSheet(card, period.name, new Map(units.map((u) => [u.id, u.name])), deps.now()),
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="report-card-${period.id}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}

export function createExportLog(deps: {
  logExport: (actorId: string, details: Record<string, unknown>) => void;
}) {
  const logged = (permission: Permission, dataset: string) =>
    createGuardedAction({
      permission,
      inSomeScope: true,
      input: z.object({ rows: z.number().int().min(0).max(100_000) }).strict(),
      handler: ({ rows }, principal) => {
        deps.logExport(principal.userId, { dataset, rows });
        return Promise.resolve(null);
      },
    });
  return {
    applicants: logged("recruitment.read", "applicants"),
    attendance: logged("meetings.read", "meeting_attendance"),
    people: logged("users.read", "accounts"),
  };
}
