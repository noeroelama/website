import type { Metadata } from "next";
import { AccessMessage } from "@/components/access-message";
import { ProfilePage } from "@/components/profile-page";
import { requireAdminViewer } from "@/server/context";

export const metadata: Metadata = { title: "Profile", robots: { index: false } };

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** Recovered profile page with edit form (Vite admin mock, ported to tokens). */
export default async function AdminProfilePage() {
  const viewer = await requireAdminViewer("/profile");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  return <ProfilePage />;
}
