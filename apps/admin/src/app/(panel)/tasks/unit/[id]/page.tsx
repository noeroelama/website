import { notFound } from "next/navigation";
import { orgUnitPath } from "@website/domain/organizations";
import { can } from "@website/permissions";
import { safeId } from "@website/security/validation";
import { AccessMessage } from "@/components/access-message";
import { TasksPage } from "@/components/tasks-page";
import { requireAdminViewer } from "@/server/context";
import { visibleTask } from "@/server/tasks";
import { adminReads, tasks } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** A unit's task board (G1): tasks.read for the unit, or shared with the viewer (view only). */
export default async function UnitBoardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAdminViewer(`/tasks/unit/${id}`);
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  if (!safeId.safeParse(id).success) notFound();
  const unit = await adminReads.getOrgUnit(id);
  const rows = unit ? await tasks().board(viewer.principal, id) : null;
  if (!unit || !rows) notFound();
  const canShare = can(viewer.principal, "tasks.share", { orgUnitPath: orgUnitPath(unit) });
  const shares = canShare ? await adminReads.boardShares(id) : [];
  const people = await adminReads.getUsers(shares);
  return (
    <TasksPage
      title={`Board: ${unit.name}`}
      description="Everything of this unit and the units below it (open first)."
      rows={rows.map((t) => visibleTask(viewer.principal, t))}
      boards={[]}
      share={
        canShare
          ? {
              orgUnitId: id,
              with: shares.map((uid) => ({ uid, email: people.get(uid)?.email ?? uid })),
            }
          : null
      }
    />
  );
}
