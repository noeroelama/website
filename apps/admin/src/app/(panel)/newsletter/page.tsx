import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { NewsletterPage } from "@/components/newsletter-page";
import { toCampaignItem, toSubscriberItem } from "@/components/newsletter-model";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

export default async function NewsletterRoute() {
  const viewer = await requireAdminViewer("/newsletter", "newsletter.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const canEdit = can(viewer.principal, "newsletter.edit");
  const [campaigns, subscribers] = await Promise.all([
    adminReads.listCampaigns(),
    adminReads.listSubscribers(),
  ]);
  return (
    <NewsletterPage
      campaigns={campaigns.map(toCampaignItem)}
      // Newsletter pages hold personal data: addresses are masked without newsletter.edit.
      subscribers={subscribers.map((s) => toSubscriberItem(s, canEdit))}
      canEdit={canEdit}
      canSend={can(viewer.principal, "newsletter.send")}
      canExport={can(viewer.principal, "newsletter.export")}
    />
  );
}
