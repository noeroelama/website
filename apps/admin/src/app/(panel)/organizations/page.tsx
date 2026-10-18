import { AccessMessage } from "@/components/access-message";
import { OrganizationsPage } from "@/components/organizations-page";
import { requireAdminViewer } from "@/server/context";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

export default async function OrganizationsRoute() {
  const viewer = await requireAdminViewer("/organizations", "organizations.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  return <OrganizationsPage />;
}
