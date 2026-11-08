import { can } from "@website/permissions";
import { recentRates, subscriberStats } from "@website/domain/newsletter";
import { AccessMessage } from "@/components/access-message";
import { authorsById, lastEditors } from "@/components/authors";
import { NewsletterPage } from "@/components/newsletter-page";
import { toCampaignItem, toSubscriberItem } from "@/components/newsletter-model";
import { requireAdminViewer } from "@/server/context";
import { getAppUrls } from "@/server/env";
import { adminReads } from "@/server/wiring";

export const instant = false;

const AUTHOR_HISTORY = 500;

export default async function NewsletterRoute() {
  const viewer = await requireAdminViewer("/newsletter", "newsletter.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const canEdit = can(viewer.principal, "newsletter.edit");
  const [campaigns, subscribers, chapters, history] = await Promise.all([
    adminReads.listCampaigns(),
    adminReads.listSubscribers(),
    adminReads.listChapters(),
    adminReads.listAudit({ module: "newsletter", limit: AUTHOR_HISTORY }),
  ]);
  const editors = lastEditors(history.items, "campaign");
  const users = await adminReads.getUsers([...new Set([...editors.values()].map((a) => a.id))]);
  const authors = authorsById(editors, users);
  const chapterName = new Map(chapters.map((c) => [c.id, c.name]));
  const now = new Date();
  return (
    <NewsletterPage
      campaigns={campaigns.map((c) => toCampaignItem(c, authors.get(c.id) ?? null))}
      subscribers={subscribers.map((s) =>
        toSubscriberItem(s, canEdit, (s.chapterId && chapterName.get(s.chapterId)) || null),
      )}
      chapters={chapters.map((c) => ({ id: c.id, name: c.name }))}
      stats={{ ...subscriberStats(subscribers, now), ...recentRates(campaigns) }}
      publicBase={getAppUrls().WEB_URL ?? ""}
      canEdit={canEdit}
      canSend={can(viewer.principal, "newsletter.send")}
      canExport={can(viewer.principal, "newsletter.export")}
    />
  );
}
