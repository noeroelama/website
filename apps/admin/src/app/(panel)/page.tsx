import { ADMIN_PAGES, type AdminPageId } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DashboardPage } from "@/components/dashboard-page";
import { formatUtc } from "@/components/format";
import { AUDIT_ACTION_LABELS, label } from "@/labels";
import { requireAdminViewer } from "@/server/context";
import { visibleTask } from "@/server/tasks";
import { dashboard } from "@/server/wiring";

const ICONS = {
  events: "event",
  albums: "gallery",
  articles: "article",
  subscribers: "newsletter",
} as const;

export const instant = false;

export default async function AdminDashboardPage() {
  const viewer = await requireAdminViewer("/");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const {
    counters,
    audit,
    graduatedOfficers,
    noLpjSecretariat,
    queues,
    agenda,
    deadlines,
    period,
  } = await dashboard()(viewer.principal);
  const link = (href: string | null, text: string) => (href ? <a href={href}>{text}</a> : text);
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
      {queues.length > 0 ? (
        <Card>
          <CardHeader title="Waiting for my action" />
          <CardBody>
            <ul>
              {queues.map((q) => (
                <li key={q.label}>
                  {link(q.href, q.label)}: <strong>{q.count}</strong>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}
      {agenda ? (
        <Card>
          <CardHeader title="Next 7 days" />
          <CardBody>
            {agenda.length === 0 ? (
              <p>Nothing scheduled.</p>
            ) : (
              <ul>
                {agenda.map((item) => (
                  <li key={item.id}>
                    <span className="admin-table__sub">{item.day ?? formatUtc(item.start)}</span> —{" "}
                    {link(item.href, item.title)}
                    {item.warnings.length ? ` (${item.warnings.join("; ")})` : ""}
                  </li>
                ))}
              </ul>
            )}
            <a href="/calendar">Open the calendar</a>
          </CardBody>
        </Card>
      ) : null}
      <Card>
        <CardHeader title="My deadlines (next 2 weeks)" />
        <CardBody>
          {deadlines.length === 0 ? (
            <p>Nothing due.</p>
          ) : (
            <ul>
              {deadlines.map((t) => (
                <li key={t.id}>
                  <span className="admin-table__sub">
                    {t.due}
                    {t.overdue ? " (overdue)" : ""}
                  </span>{" "}
                  — {link(visibleTask(viewer.principal, t).href, t.title)}
                </li>
              ))}
            </ul>
          )}
          <a href="/tasks">Open My Tasks</a>
        </CardBody>
      </Card>
      {period ? (
        <Card>
          <CardHeader title={`Period ${period.name}`} />
          <CardBody>
            <p>
              {period.programs} programmes, {period.running} running.{" "}
              <a href="/programs">Open Programmes</a>
            </p>
          </CardBody>
        </Card>
      ) : null}
      {noLpjSecretariat ? (
        <Card>
          <CardHeader title="Nobody can review LPJs" />
          <CardBody>
            <p>
              No account holds the LPJ secretariat desk (<code>lpj.review_secretariat</code>,
              global). Give it to the Secretariat bureau in Role Manager, otherwise no LPJ can be
              approved.
            </p>
          </CardBody>
        </Card>
      ) : null}
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
