import type { Metadata } from "next";
import { AppShell } from "@website/ui";

export const metadata: Metadata = { title: "Gallery" };

// Public and fully prerendered. Content comes in its own phase.
export default function GalleryPage() {
  return <AppShell title="Gallery" />;
}
