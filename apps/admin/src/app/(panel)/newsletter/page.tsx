import { AccessMessage } from "@/components/access-message";
import { requireAdminViewer } from "@/server/context";

// Login required: rendered at request time so a signed-out visitor gets a real 307 to sign-in.
export const instant = false;

export default async function NewsletterPage() {
  const viewer = await requireAdminViewer("/newsletter", "newsletter.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  return <h1>Newsletter</h1>;
}
