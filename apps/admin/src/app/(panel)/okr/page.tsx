import { canChangePeriod, inTreeOrder, orgUnitPath } from "@website/domain/organizations";
import { keyResultPercent, objectivePercent } from "@website/domain/programs";
import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { OkrPage } from "@/components/okr-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

export const instant = false;

export default async function AdminOkrPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminViewer("/okr", "okr.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { principal } = viewer;
  const asked = (await searchParams)["period"];
  const periods = await adminReads.listPeriods();
  const period =
    periods.find((p) => p.id === asked) ?? periods.find((p) => p.status === "active") ?? periods[0];
  if (!period) return <OkrPage period={null} periods={[]} objectives={[]} units={[]} />;
  const [objectives, units] = await Promise.all([
    adminReads.listObjectives(period.id),
    adminReads.listOrgUnits(period.id),
  ]);
  const writable = canChangePeriod(period.status);
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  return (
    <OkrPage
      period={{
        id: period.id,
        version: period.version,
        name: period.name,
        status: period.status,
        vision: period.vision,
        mission: period.mission,
        canEdit: writable && can(principal, "okr.edit"),
      }}
      periods={periods.map((p) => ({ id: p.id, name: p.name }))}
      objectives={objectives.map((o) => ({
        id: o.id,
        version: o.version,
        title: o.title,
        description: o.description,
        orgUnitId: o.orgUnitId,
        sort: o.sort,
        unitName: o.orgUnitId ? (unitName.get(o.orgUnitId) ?? "") : "Region",
        percent: objectivePercent(o),
        canEdit: writable && can(principal, "okr.edit", { orgUnitPath: o.orgUnitPath }),
        keyResults: o.keyResults.map((kr) => ({
          id: kr.id,
          title: kr.title,
          unit: kr.unit,
          baseline: kr.baseline,
          target: kr.target,
          current: kr.current,
          direction: kr.direction,
          sort: kr.sort,
          percent: keyResultPercent(kr),
        })),
      }))}
      units={
        writable
          ? inTreeOrder(units)
              .filter(
                (u) => !u.deletedAt && can(principal, "okr.edit", { orgUnitPath: orgUnitPath(u) }),
              )
              .map((u) => ({ id: u.id, name: u.name }))
          : []
      }
    />
  );
}
