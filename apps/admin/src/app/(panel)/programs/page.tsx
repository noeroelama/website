import { WorkflowGuide } from "@website/ui";
import { WORKFLOWS } from "@/components/workflow-guides";
import { canChangePeriod, inTreeOrder, orgUnitPath } from "@website/domain/organizations";
import { can, canInSomeScope } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { ProgramsPage } from "@/components/programs-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** Programmes (E2) of one period (`?period=`, default the active one) the viewer can read. */
export default async function AdminProgramsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminViewer("/programs", "programs.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { principal } = viewer;
  const asked = (await searchParams)["period"];
  const periods = await adminReads.listPeriods();
  const period =
    periods.find((p) => p.id === asked) ?? periods.find((p) => p.status === "active") ?? periods[0];
  if (!period) return <ProgramsPage period={null} periods={[]} rows={[]} plan={null} />;
  const [programs, units, objectives] = await Promise.all([
    adminReads.listPrograms(period.id),
    adminReads.listOrgUnits(period.id),
    adminReads.listObjectives(period.id),
  ]);
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const editable = canChangePeriod(period.status)
    ? inTreeOrder(units).filter(
        (u) => !u.deletedAt && can(principal, "programs.edit", { orgUnitPath: orgUnitPath(u) }),
      )
    : [];
  return (
    <>
      <WorkflowGuide id="programs" flow={WORKFLOWS.programs} />
      <ProgramsPage
        period={{ id: period.id, name: period.name, status: period.status }}
        periods={periods.map((p) => ({ id: p.id, name: p.name }))}
        rows={programs
          .filter((p) => can(principal, "programs.read", { orgUnitPath: p.orgUnitPath }))
          .map((p) => ({
            id: p.id,
            name: p.name,
            unitName: unitName.get(p.orgUnitId) ?? "",
            status: p.status,
            progress: p.progressPercent,
            health: p.health?.status ?? null,
            mine: p.pics.includes(principal.userId),
          }))}
        plan={
          editable.length > 0 && canInSomeScope(principal, "programs.edit")
            ? {
                units: editable.map((u) => ({ id: u.id, name: u.name })),
                keyResults: objectives.flatMap((o) =>
                  o.keyResults.map((kr) => ({
                    value: `${o.id}:${kr.id}`,
                    label: `${o.title} → ${kr.title}`,
                  })),
                ),
              }
            : null
        }
      />
    </>
  );
}
