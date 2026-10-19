import { ADMIN_PAGES, type AdminPageId } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DashboardPage } from "@/components/dashboard-page";
import { formatUtc } from "@/components/format";
import { AUDIT_ACTION_LABELS, label } from "@/labels";
import { requireAdminViewer } from "@/server/context";
import { dashboard } from "@/server/wiring";

const ICONS = {
  events: "event",
  albums: "gallery",
  articles: "article",
  subscribers: "newsletter",
} as const;

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

export default async function AdminDashboardPage() {
  const viewer = await requireAdminViewer("/");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { counters, audit, graduatedOfficers } = await dashboard()(viewer.principal);
  return (
    <DashboardPage
      name={viewer.name ?? viewer.email ?? "Admin"}
      counters={counters.map((c) => ({
        label: c.label,
        value: c.value.toLocaleString("en"),
        icon: ICONS[c.key],
        href: c.href,
      }))}
      audit={
        audit &&
        audit.map((entry) => {
          const page = ADMIN_PAGES[entry.module as AdminPageId] as { label: string } | undefined;
          return {
            id: entry.id,
            when: formatUtc(entry.occurredAt),
            who: entry.actor.email ?? entry.actor.id,
            what: `${label(AUDIT_ACTION_LABELS, entry.action)} ${page?.label ?? entry.resourceType}${entry.title ? ` “${entry.title}”` : ""}`,
          };
        })
      }
    >
      {graduatedOfficers && graduatedOfficers.length > 0 ? (
        <Card>
          <CardHeader title="Graduated officers still in office" />
          <CardBody>
            <p>
              Graduation never ends an appointment by itself: decide on the period&apos;s Structure
              page whether to end it.
            </p>
            <ul>
              {graduatedOfficers.map((o) => (
                <li key={`${o.periodId}-${o.name}-${o.title}`}>
                  <a href={`/organizations/periods/${o.periodId}`}>
                    {o.title} — {o.name}
                  </a>{" "}
                  <span className="admin-table__sub">graduated {o.graduatedOn}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
    </DashboardPage>
  );
}
