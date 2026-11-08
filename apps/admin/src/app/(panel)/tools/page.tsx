import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { ToolsPage } from "@/components/tools-page";
import { requireAdminViewer } from "@/server/context";
import { linkRow } from "@/server/links";
import { adminReads } from "@/server/wiring";

export const instant = false;

export default async function AdminToolsPage() {
  const viewer = await requireAdminViewer("/tools", "tools.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const links = await adminReads.listShortLinks();
  return (
    <ToolsPage initialLinks={links.map(linkRow)} canEdit={can(viewer.principal, "tools.edit")} />
  );
}
