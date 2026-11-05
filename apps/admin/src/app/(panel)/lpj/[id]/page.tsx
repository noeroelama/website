import { WorkflowGuide } from "@website/ui";
import { WORKFLOWS } from "@/components/workflow-guides";
import { notFound } from "next/navigation";
import { formatMoney, isOverdue, LPJ_DESKS } from "@website/domain/programs";
import { can, canAccessAdmin } from "@website/permissions";
import { safeId } from "@website/security/validation";
import { AccessMessage } from "@/components/access-message";
import { LpjReportPage } from "@/components/lpj-page";
import { requireAdminViewer } from "@/server/context";
import { deskPermission } from "@/server/lpj";
import { canManageProgram } from "@/server/programs";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** One LPJ: the frozen plan, the PICs' part, the desks (lpj.read, or the programme's readers). */
export default async function LpjRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAdminViewer(`/lpj/${id}`);
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { principal } = viewer;
  if (!safeId.safeParse(id).success || !canAccessAdmin(principal)) notFound();
  const lpj = await adminReads.getLpj(id);
  const scope = { orgUnitPath: lpj?.orgUnitPath ?? [] };
  if (!lpj || !(can(principal, "lpj.read", scope) || can(principal, "programs.read", scope))) {
    notFound();
  }
  const uids = [...lpj.plan.pics, lpj.submittedBy, ...LPJ_DESKS.map((d) => lpj[d]?.uid)];
  const people = await adminReads.getUsers(
    [...new Set(uids)].filter((u): u is string => typeof u === "string"),
  );
  const name = (uid: string) => people.get(uid)?.name ?? people.get(uid)?.email ?? uid;
  const writable = lpj.status === "draft" || lpj.status === "returned";
  return (
    <>
      <WorkflowGuide id="lpj" flow={WORKFLOWS.lpj} current={lpj.status} />
      <LpjReportPage
        lpj={{
          id: lpj.id,
          version: lpj.version,
          status: lpj.status,
          dueOn: lpj.dueOn,
          overdue: isOverdue(lpj, new Date()),
          revisionRound: lpj.revisionRound,
          returnNote: lpj.returnNote,
          plan: {
            name: lpj.plan.name,
            unitName: lpj.plan.unitName,
            goal: lpj.plan.goal,
            planned: [lpj.plan.plannedStart, lpj.plan.plannedEnd].filter(Boolean).join(" – "),
            budgets: lpj.plan.budgets.map(formatMoney),
            pics: lpj.plan.pics.map(name),
            progressPercent: lpj.plan.progressPercent,
            milestones: lpj.plan.milestones.map((m) => ({ title: m.title, done: m.done })),
          },
          input: {
            realization: lpj.realization,
            obstacles: lpj.obstacles,
            recommendations: lpj.recommendations,
            participantCount: lpj.participantCount,
            realized: lpj.realized ? [...lpj.realized] : null,
          },
          realizedText: lpj.realized ? lpj.realized.map(formatMoney).join(", ") || "0" : null,
          desks: LPJ_DESKS.map((d) => ({
            desk: d,
            signedBy: lpj[d] ? name(lpj[d].uid) : null,
            at: lpj[d] ? lpj[d].at.toISOString().slice(0, 10) : null,
            canSign:
              lpj.status === "submitted" && !lpj[d] && can(principal, deskPermission(d), scope),
          })),
        }}
        can={{
          write: writable && canManageProgram(principal, lpj),
          return:
            lpj.status === "submitted" &&
            LPJ_DESKS.some((d) => can(principal, deskPermission(d), scope)),
          extend: lpj.status !== "approved" && can(principal, "programs.approve", scope),
        }}
      />
    </>
  );
}
