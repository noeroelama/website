import type { Metadata } from "next";
import { AppShell } from "@website/ui";

export const metadata: Metadata = { title: "About" };

// Public and fully prerendered. Content comes in its own phase.
export default function AboutPage() {
  return <AppShell title="About" />;
}
