import { notFound } from "next/navigation";
import { AccessMessage } from "@/components/access-message";
import { OrgUnitEditor } from "@/components/org-unit-editor";
import { toOrgUnitItem } from "@/components/org-units-model";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** Organizations → Period → Structure → Edit Unit. */
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
  const all = await adminReads.listOrgUnits(id);
  return <OrgUnitEditor periodId={id} unit={toOrgUnitItem(unit)} units={all.map(toOrgUnitItem)} />;
}
