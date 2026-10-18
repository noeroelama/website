import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { toArticleItem } from "@/components/articles-model";
import { ArticlesPage } from "@/components/articles-page";
import { requireAdminViewer } from "@/server/context";
import { getAppUrls } from "@/server/env";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

export default async function AdminArticlesPage() {
  const viewer = await requireAdminViewer("/articles", "articles.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const now = new Date();
  const items = await adminReads.listNews();
  return (
    <ArticlesPage
      initial={items.map((item) => toArticleItem(item, now))}
      canEdit={can(viewer.principal, "articles.edit")}
      canPublish={can(viewer.principal, "articles.publish")}
      publicBase={getAppUrls().WEB_URL ?? ""}
      defaultAuthor={viewer.name ?? ""}
    />
  );
}
