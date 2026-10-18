import { notFound } from "next/navigation";
import { formatNewsDate } from "@website/domain/content";
import { sanitizeRichText } from "@website/security/html";
import { safeId } from "@website/security/validation";
import { ArticleView } from "@website/ui";
import { AccessMessage } from "@/components/access-message";
import { label, NEWS_CATEGORY_LABELS } from "@/labels";
import { requireAdminViewer } from "@/server/context";
import { getAppUrls } from "@/server/env";
import { adminReads } from "@/server/wiring";

export const instant = false;

/** Admin-only preview of a saved news article (also drafts), in the public site's default language. */
export default async function ArticlePreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireAdminViewer(`/articles/${id}/preview`, "articles.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  if (!safeId.safeParse(id).success) notFound();
  const item = await adminReads.getContent(id);
  if (!item || item.kind !== "news" || item.deletedAt !== null) notFound();
  const web = getAppUrls().WEB_URL ?? "";
  return (
    <>
      <p className="admin-page-header__desc">Preview — {item.status}. Visitors see it like this.</p>
      <ArticleView
        title={item.title}
        author={item.author}
        date={formatNewsDate(item.publishAt ?? item.updatedAt, "id")}
        category={label(NEWS_CATEGORY_LABELS, item.category, "id")}
        image={item.featuredImage}
        safeHtml={sanitizeRichText(item.body)}
        tags={item.tags.map((tag) => ({
          label: tag,
          href: `${web}/news?tag=${encodeURIComponent(tag)}`,
        }))}
      />
    </>
  );
}
