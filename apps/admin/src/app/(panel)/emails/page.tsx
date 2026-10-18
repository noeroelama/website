import type { Metadata } from "next";
import { AccessMessage } from "@/components/access-message";
import { EmailsPage } from "@/components/emails-page";
import { requireAdminViewer } from "@/server/context";

export const metadata: Metadata = { title: "Emails", robots: { index: false } };

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** Recovered "Emails" inbox (Vite admin mock, ported to tokens). */
export default async function AdminEmailsPage() {
  const viewer = await requireAdminViewer("/emails");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  return <EmailsPage />;
}
