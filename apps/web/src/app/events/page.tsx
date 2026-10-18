import type { Metadata } from "next";
import { AppShell } from "@website/ui";
import { Localized } from "@/i18n/localized";

export const metadata: Metadata = { title: "Events" };

// Public and prerendered. Content comes in its own step.
export default function EventsPage() {
  return <Localized render={(t) => <AppShell title={t.pages.events} />} />;
}
