import { AccessMessage } from "@/components/access-message";
import { ArticlesPage } from "@/components/articles-page";
import { requireAdminViewer } from "@/server/context";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

export default async function AdminArticlesPage() {
  const viewer = await requireAdminViewer("/articles", "articles.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  return <ArticlesPage />;
}
