import { canInSomeScope } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { TasksPage } from "@/components/tasks-page";
import { requireAdminViewer } from "@/server/context";
import { visibleTask } from "@/server/tasks";
import { adminReads, tasks } from "@/server/wiring";

export const instant = false;

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
