import { can, scopedChapterIds } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { toChapterItem } from "@/components/chapters-model";
import { OrganizationsPage } from "@/components/organizations-page";
import { toPeriodItem } from "@/components/periods-model";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

export default async function OrganizationsRoute() {
  const viewer = await requireAdminViewer("/organizations", "organizations.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const canReadPeriods = can(viewer.principal, "periods.read");
  const contactScope = scopedChapterIds(viewer.principal, "organizations.edit");
  const [chapters, periods] = await Promise.all([
    adminReads.listChapters(),
    canReadPeriods ? adminReads.listPeriods() : null,
  ]);
  return (
    <OrganizationsPage
      chapters={chapters.map(toChapterItem)}
      canEdit={can(viewer.principal, "organizations.edit")}
      contactEditIds={contactScope === "all" ? [] : contactScope}
      periods={periods?.map(toPeriodItem) ?? null}
      canEditPeriods={can(viewer.principal, "periods.edit")}
    />
  );
}
