import type { Metadata } from "next";
import { AccessMessage } from "@/components/access-message";
import { AccountAccountPage } from "@/components/account-account-page";
import { requireAdminViewer } from "@/server/context";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** Recovered full "Your account" page (Vite admin mock, ported to tokens). */
export default async function AdminAccountPage() {
  const viewer = await requireAdminViewer("/account");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  return <AccountAccountPage />;
}
