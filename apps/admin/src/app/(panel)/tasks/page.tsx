import { canInSomeScope } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { TasksPage } from "@/components/tasks-page";
import { requireAdminViewer } from "@/server/context";
import { visibleTask } from "@/server/tasks";
import { adminReads, tasks } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** My Tasks (G1): my follow-ups, dispositions and milestones; links to unit boards. */
export default async function MyTasksPage() {
  const viewer = await requireAdminViewer("/tasks");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { principal } = viewer;
  const period = await adminReads.activePeriod();
  const [mine, shared, units] = await Promise.all([
    tasks().mine(principal.userId),
    adminReads.sharedBoards(principal.userId),
    period ? adminReads.listOrgUnits(period.id) : Promise.resolve([]),
  ]);
  const boards =
    canInSomeScope(principal, "tasks.read") || shared.length > 0
      ? units.filter((u) => !u.deletedAt).map((u) => ({ id: u.id, name: u.name }))
      : [];
  return (
    <TasksPage
      title="My Tasks"
      description="Follow-ups, dispositions and milestones assigned to you. Finish them where they come from."
      rows={mine.map((t) => visibleTask(principal, t))}
      boards={boards}
      share={null}
    />
  );
}
