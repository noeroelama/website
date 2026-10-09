import { AppShell, StatusBadge } from "@website/ui";

// Fully prerendered at build (no request-time data), so it keeps serving even if admin, shop or
// the database is down. Cache content with "use cache" + cacheLife (docs/architecture.md#rendering).

export default function HomePage() {
  return (
    <AppShell title="Public website">
      <p>
        <StatusBadge label="web: ok" status="ok" />
      </p>
      <p>News, articles, events, gallery, organization and chapters will live here.</p>
    </AppShell>
  );
}
