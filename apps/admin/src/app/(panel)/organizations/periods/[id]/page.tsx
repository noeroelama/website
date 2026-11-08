import { notFound } from "next/navigation";
import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { OrgStructurePage } from "@/components/org-structure-page";
import { toOrgUnitItem } from "@/components/org-units-model";
import { toPeriodItem } from "@/components/periods-model";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

export const instant = false;

export default async function PeriodStructureRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requireAdminViewer(`/organizations/periods/${id}`, "structure.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const period = await adminReads.getPeriod(id);
  if (!period || period.deletedAt) notFound();
  const [periods, units] = await Promise.all([
    adminReads.listPeriods(),
    adminReads.listOrgUnits(period.id),
  ]);
  return (
    <OrgStructurePage
      period={toPeriodItem(period)}
      periods={periods.map(toPeriodItem)}
      units={units.map(toOrgUnitItem)}
      canEdit={can(viewer.principal, "structure.edit") && period.status !== "archived"}
    />
  );
}
