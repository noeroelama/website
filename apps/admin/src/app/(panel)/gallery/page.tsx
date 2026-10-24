import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { GalleryPage } from "@/components/gallery-page";
import { authorsById, lastEditors } from "@/components/authors";
import { toAlbumItem } from "@/components/gallery-model";
import { EVENT_TYPE_LABELS, label } from "@/labels";
import { requireAdminViewer } from "@/server/context";
import { getAppUrls } from "@/server/env";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** Newest gallery audit entries read for the "Author" column (one query). */
const AUTHOR_HISTORY = 500;

export default async function AdminGalleryPage() {
  const viewer = await requireAdminViewer("/gallery", "gallery.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const [albums, events, history] = await Promise.all([
    adminReads.listAlbums(),
    adminReads.listEvents(),
    adminReads.listAudit({ module: "gallery", limit: AUTHOR_HISTORY }),
  ]);
  // Author = whoever made the album's newest change; names from users/{uid} in one batched read.
  const editors = lastEditors(history.items, "album");
  const users = await adminReads.getUsers([...new Set([...editors.values()].map((a) => a.id))]);
  const authors = authorsById(editors, users);
  const typeOf = new Map(events.map((e) => [e.id, label(EVENT_TYPE_LABELS, e.type)]));
  return (
    <GalleryPage
      initial={albums.map((a) =>
        toAlbumItem(a, typeOf.get(a.eventId) ?? "", authors.get(a.id) ?? null),
      )}
      events={events.filter((e) => e.published).map((e) => ({ id: e.id, title: e.title }))}
      canEdit={can(viewer.principal, "gallery.edit")}
      publicBase={getAppUrls().WEB_URL ?? ""}
    />
  );
}
