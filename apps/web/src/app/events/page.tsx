import type { Metadata } from "next";
import { AppShell } from "@website/ui";

export const metadata: Metadata = { title: "Events" };

// Public and fully prerendered. Content comes in its own phase.
export default function EventsPage() {
  return <AppShell title="Events" />;
}
