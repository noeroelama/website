import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { toArticleItem } from "@/components/articles-model";
import { authorsById, lastEditors } from "@/components/authors";
import { ArticlesPage } from "@/components/articles-page";
import { requireAdminViewer } from "@/server/context";
import { getAppUrls } from "@/server/env";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** Newest article audit entries read for the "Last Modified" editor (one query, as on Event). */
const EDITOR_HISTORY = 500;

export default async function AdminArticlesPage() {
  const viewer = await requireAdminViewer("/articles", "articles.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const now = new Date();
  const [items, history] = await Promise.all([
    adminReads.listNews(),
    adminReads.listAudit({ module: "articles", limit: EDITOR_HISTORY }),
  ]);
  // Editor = whoever made the article's newest change; names from users/{uid} in one batched read.
  const editors = lastEditors(history.items, "content");
  const users = await adminReads.getUsers([...new Set([...editors.values()].map((a) => a.id))]);
  const authors = authorsById(editors, users);
  return (
    <ArticlesPage
      initial={items.map((item) => toArticleItem(item, now, authors.get(item.id) ?? null))}
      canEdit={can(viewer.principal, "articles.edit")}
      canPublish={can(viewer.principal, "articles.publish")}
      publicBase={getAppUrls().WEB_URL ?? ""}
      defaultAuthor={viewer.name ?? viewer.email ?? ""}
    />
  );
}
