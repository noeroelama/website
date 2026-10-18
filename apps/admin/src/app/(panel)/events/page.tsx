import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { toEventItem } from "@/components/events-model";
import { EventsPage } from "@/components/events-page";
import { requireAdminViewer } from "@/server/context";
import { getAppUrls } from "@/server/env";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

export default async function AdminEventsPage() {
  const viewer = await requireAdminViewer("/events", "events.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const events = await adminReads.listEvents();
  return (
    <EventsPage
      initial={events.map(toEventItem)}
      canEdit={can(viewer.principal, "events.edit")}
      publicBase={getAppUrls().WEB_URL ?? ""}
    />
  );
}
