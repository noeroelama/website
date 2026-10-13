import { AccessMessage } from "@/components/access-message";
import { requireAdminViewer } from "@/server/context";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

export default async function DashboardPage() {
  const viewer = await requireAdminViewer("/");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  return <h1>Dashboard</h1>;
}
