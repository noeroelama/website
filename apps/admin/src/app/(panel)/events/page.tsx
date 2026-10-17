import { AccessMessage } from "@/components/access-message";
import { EventsPage } from "@/components/events-page";
import { requireAdminViewer } from "@/server/context";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

export default async function AdminEventsPage() {
  const viewer = await requireAdminViewer("/events", "events.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  return <EventsPage />;
}
