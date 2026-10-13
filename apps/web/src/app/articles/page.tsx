import type { Metadata } from "next";
import { AppShell } from "@website/ui";

export const metadata: Metadata = { title: "Articles" };

// Public and fully prerendered. Content comes in its own phase.
export default function ArticlesPage() {
  return <AppShell title="Articles" />;
}
