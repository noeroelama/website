import { WorkflowGuide } from "@website/ui";
import { WORKFLOWS } from "@/components/workflow-guides";
import { isOverdue } from "@website/domain/programs";
import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { LpjListPage } from "@/components/lpj-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** LPJ desks (E4): the period's LPJs with status, due date and overdue (read-time rule). */
export default async function AdminLpjPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminViewer("/lpj", "lpj.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const asked = (await searchParams)["period"];
  const periods = await adminReads.listPeriods();
  const period =
    periods.find((p) => p.id === asked) ?? periods.find((p) => p.status === "active") ?? periods[0];
  const reports = period ? await adminReads.listLpj(period.id) : [];
  const now = new Date();
  return (
    <>
      <WorkflowGuide id="lpj" flow={WORKFLOWS.lpj} />
      <LpjListPage
        period={period ? { id: period.id, name: period.name } : null}
        periods={periods.map((p) => ({ id: p.id, name: p.name }))}
        rows={reports
          .filter((l) => can(viewer.principal, "lpj.read", { orgUnitPath: l.orgUnitPath }))
          .map((l) => ({
            id: l.id,
            name: l.plan.name,
            unitName: l.plan.unitName,
            status: l.status,
            dueOn: l.dueOn,
            overdue: isOverdue(l, now),
            desks: [l.secretariat, l.treasurer, l.approval].filter(Boolean).length,
          }))}
      />
    </>
  );
}
