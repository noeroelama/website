import { WorkflowGuide } from "@website/ui";
import { WORKFLOWS } from "@/components/workflow-guides";
import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { authorsById, lastEditors } from "@/components/authors";
import { toEventItem } from "@/components/events-model";
import { EventsPage } from "@/components/events-page";
import { requireAdminViewer } from "@/server/context";
import { getAppUrls } from "@/server/env";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** Newest event audit entries read for the "Last Modified" author (one query). */
const AUTHOR_HISTORY = 500;

export default async function AdminEventsPage() {
  const viewer = await requireAdminViewer("/events", "events.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const [events, history] = await Promise.all([
    adminReads.listEvents(),
    adminReads.listAudit({ module: "events", limit: AUTHOR_HISTORY }),
  ]);
  // Author = whoever made the event's newest change; names from users/{uid} in one batched read.
  const editors = lastEditors(history.items, "event");
  const users = await adminReads.getUsers([...new Set([...editors.values()].map((a) => a.id))]);
  const authors = authorsById(editors, users);
  return (
    <>
      <WorkflowGuide id="events" flow={WORKFLOWS.events} />
      <EventsPage
        initial={events.map((e) => toEventItem(e, authors.get(e.id) ?? null))}
        canEdit={can(viewer.principal, "events.edit")}
        publicBase={getAppUrls().WEB_URL ?? ""}
      />
    </>
  );
}
