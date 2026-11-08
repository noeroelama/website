import { isOverdue } from "@website/domain/programs";
import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { LpjListPage } from "@/components/lpj-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

export const instant = false;

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
  );
}
