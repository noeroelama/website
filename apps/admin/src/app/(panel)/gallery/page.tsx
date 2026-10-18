import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { GalleryPage } from "@/components/gallery-page";
import { toAlbumItem } from "@/components/gallery-model";
import { requireAdminViewer } from "@/server/context";
import { getAppUrls } from "@/server/env";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

export default async function AdminGalleryPage() {
  const viewer = await requireAdminViewer("/gallery", "gallery.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const [albums, events] = await Promise.all([adminReads.listAlbums(), adminReads.listEvents()]);
  return (
    <GalleryPage
      initial={albums.map(toAlbumItem)}
      events={events.filter((e) => e.published).map((e) => ({ id: e.id, title: e.title }))}
      canEdit={can(viewer.principal, "gallery.edit")}
      publicBase={getAppUrls().WEB_URL ?? ""}
    />
  );
}
