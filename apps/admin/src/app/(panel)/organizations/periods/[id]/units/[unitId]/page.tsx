import { notFound } from "next/navigation";
import { AccessMessage } from "@/components/access-message";
import { OrgUnitEditor } from "@/components/org-unit-editor";
import { toOrgUnitItem } from "@/components/org-units-model";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

export const instant = false;

export default async function EditUnitRoute({
  params,
}: {
  params: Promise<{ id: string; unitId: string }>;
}) {
  const { id, unitId } = await params;
  const viewer = await requireAdminViewer(
    `/organizations/periods/${id}/units/${unitId}`,
    "structure.edit",
  );
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const unit = await adminReads.getOrgUnit(unitId);
  if (!unit || unit.deletedAt || unit.periodId !== id) notFound();
  return <OrgUnitEditor periodId={id} unit={toOrgUnitItem(unit)} />;
}
