import { notFound } from "next/navigation";
import { AccessMessage } from "@/components/access-message";
import { OrgUnitEditor } from "@/components/org-unit-editor";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** Organizations → Period → Structure → Create Unit. */
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
