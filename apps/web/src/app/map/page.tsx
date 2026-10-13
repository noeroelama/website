import type { Metadata } from "next";
import { AppShell } from "@website/ui";

export const metadata: Metadata = { title: "Map" };

// Public and fully prerendered. Content comes in its own phase.
export default function MapPage() {
  return <AppShell title="Map" />;
}
