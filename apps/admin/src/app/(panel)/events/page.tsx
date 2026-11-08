import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { authorsById, lastEditors } from "@/components/authors";
import { toEventItem } from "@/components/events-model";
import { EventsPage } from "@/components/events-page";
import { requireAdminViewer } from "@/server/context";
import { getAppUrls } from "@/server/env";
import { adminReads } from "@/server/wiring";

export const instant = false;

const AUTHOR_HISTORY = 500;

export default async function AdminEventsPage() {
  const viewer = await requireAdminViewer("/events", "events.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const [events, history] = await Promise.all([
    adminReads.listEvents(),
    adminReads.listAudit({ module: "events", limit: AUTHOR_HISTORY }),
  ]);
  const editors = lastEditors(history.items, "event");
  const users = await adminReads.getUsers([...new Set([...editors.values()].map((a) => a.id))]);
  const authors = authorsById(editors, users);
  return (
    <EventsPage
      initial={events.map((e) => toEventItem(e, authors.get(e.id) ?? null))}
      canEdit={can(viewer.principal, "events.edit")}
      publicBase={getAppUrls().WEB_URL ?? ""}
    />
  );
}
