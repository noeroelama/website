import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { CalendarPage } from "@/components/calendar-page";
import { requireAdminViewer } from "@/server/context";
import { adminReads, calendar } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/** Calendar (G2): one month (`?month=YYYY-MM`, default this month, UTC days). */
export default async function AdminCalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminViewer("/calendar", "calendar.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { principal } = viewer;
  const asked = (await searchParams)["month"];
  const month =
    typeof asked === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked)
      ? asked
      : new Date().toISOString().slice(0, 7);
  const from = new Date(`${month}-01T00:00:00Z`);
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1) - 1);
  const canHolidays = can(principal, "calendar.holidays");
  const [items, feedUrl, holidays] = await Promise.all([
    calendar().items(principal, from, to),
    calendar().feedUrl(principal.userId),
    canHolidays ? adminReads.listHolidays() : Promise.resolve(null),
  ]);
  return (
    <CalendarPage
      month={month}
      items={items.map((i) => ({
        id: i.id,
        kind: i.kind,
        title: i.title,
        day: i.day ?? (i.start as Date).toISOString().slice(0, 10),
        time: i.start ? `${i.start.toISOString().slice(11, 16)} UTC` : null,
        href: i.href,
        warnings: [...i.warnings],
      }))}
      feedUrl={feedUrl}
      holidays={holidays}
    />
  );
}
