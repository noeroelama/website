import { notFound } from "next/navigation";
import { can, isSystemRoleId } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { OrgStructurePage } from "@/components/org-structure-page";
import { toOrgUnitItem } from "@/components/org-units-model";
import { toPeriodItem } from "@/components/periods-model";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** Organizations → Period → Structure: the unit tree of one board period. */
export default async function PeriodStructureRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await requireAdminViewer(`/organizations/periods/${id}`, "structure.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const period = await adminReads.getPeriod(id);
  if (!period) notFound();
  const canReadPeople = can(viewer.principal, "appointments.read");
  const canEditRoles = can(viewer.principal, "roles.edit");
  const [periods, units, appointments, roleMap, roles] = await Promise.all([
    adminReads.listPeriods(),
    adminReads.listOrgUnits(period.id),
    canReadPeople ? adminReads.listAppointments(period.id) : [],
    canEditRoles ? adminReads.getAppointmentRoleMap() : null,
    canEditRoles ? adminReads.listRoles() : [],
  ]);
  return (
    <OrgStructurePage
      period={toPeriodItem(period)}
      periods={periods.map(toPeriodItem)}
      units={units.map(toOrgUnitItem)}
      canEdit={can(viewer.principal, "structure.edit") && period.status !== "archived"}
      appointments={appointments
        .filter((a) => a.status === "active")
        .map((a) => ({
          id: a.id,
          version: a.version,
          orgUnitId: a.orgUnitId,
          name: a.name,
          title: a.title,
          seat: a.seat,
          status: a.status,
        }))}
      canAppoint={can(viewer.principal, "appointments.edit") && period.status === "active"}
      roleMap={canEditRoles ? roleMap : undefined}
      roles={roles.filter((r) => !isSystemRoleId(r.id)).map((r) => ({ id: r.id, name: r.name }))}
    />
  );
}
