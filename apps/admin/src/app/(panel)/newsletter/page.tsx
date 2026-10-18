import { AccessMessage } from "@/components/access-message";
import { NewsletterPage } from "@/components/newsletter-page";
import { requireAdminViewer } from "@/server/context";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

export default async function NewsletterRoute() {
  const viewer = await requireAdminViewer("/newsletter", "newsletter.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  return <NewsletterPage />;
}
