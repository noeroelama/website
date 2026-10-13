import { AccessMessage } from "@/components/access-message";
import { requireAdminViewer } from "@/server/context";

// Login required: rendered at request time so a signed-out visitor gets a real 307 to sign-in.
export const instant = false;

export default async function AuditLogPage() {
  const viewer = await requireAdminViewer("/audit", "audit.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  return <h1>Audit Log</h1>;
}
