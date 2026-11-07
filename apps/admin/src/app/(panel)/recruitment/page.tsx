import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { toRecruitmentItem } from "@/components/recruitment-model";
import { RecruitmentPage } from "@/components/recruitment-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

export default async function AdminRecruitmentPage() {
  const viewer = await requireAdminViewer("/recruitment", "recruitment.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const [recruitments, periods, forms] = await Promise.all([
    adminReads.listRecruitments(),
    adminReads.listPeriods(),
    adminReads.listForms(),
  ]);
  const changeable = periods.filter((p) => p.status !== "archived");
  const [seats, units] = await Promise.all([
    adminReads.recruitmentSeats(recruitments.map((r) => r.id)),
    Promise.all(changeable.map((p) => adminReads.listOrgUnits(p.id))),
  ]);
  const periodName = new Map(periods.map((p) => [p.id, p.name]));
  const now = new Date();
  return (
    <RecruitmentPage
      initial={recruitments.map((r) =>
        toRecruitmentItem(r, periodName.get(r.periodId) ?? "", seats.get(r.id) ?? new Map(), now),
      )}
      periods={changeable.map((p) => ({ id: p.id, name: p.name }))}
      unitsByPeriod={Object.fromEntries(
        changeable.map((p, i) => [
          p.id,
          (units[i] ?? []).map((u) => ({ id: u.id, name: u.name, path: [...u.path] })),
        ]),
      )}
      forms={forms
        .filter((f) => f.usage === "recruitment")
        .map((f) => ({ id: f.id, title: f.title, currentVersion: f.currentVersion }))}
      canEdit={can(viewer.principal, "recruitment.edit")}
    />
  );
}
