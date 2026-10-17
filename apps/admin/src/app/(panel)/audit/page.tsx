import { AccessMessage } from "@/components/access-message";
import { AuditLogPage } from "@/components/audit-log-page";
import { requireAdminViewer } from "@/server/context";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

export default async function AuditPage() {
  const viewer = await requireAdminViewer("/audit", "audit.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  return <AuditLogPage />;
}
