import { notFound } from "next/navigation";
import { AccessMessage } from "@/components/access-message";
import { OrgUnitEditor } from "@/components/org-unit-editor";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

export const instant = false;

export default async function CreateUnitRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAdminViewer(
    `/organizations/periods/${id}/units/new`,
    "structure.edit",
  );
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const period = await adminReads.getPeriod(id);
  if (!period || period.deletedAt) notFound();
  return <OrgUnitEditor periodId={period.id} unit={null} />;
}
