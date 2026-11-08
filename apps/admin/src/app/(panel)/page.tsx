import { isSuperadmin } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { PageViewsCard, VIEW_PERIODS } from "@/components/page-views-card";
import { StatCard, type StatCardProps } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireAdminViewer } from "@/server/context";
import { getAdminEnv } from "@/server/env";
import { pageViewReport, pageViewStore } from "@/server/page-views";
import { integrationStatus } from "@/server/settings";
import { dashboard } from "@/server/wiring";

export const instant = false;

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminViewer("/");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const { queues, overdue, graduatedOfficers, noLpjSecretariat } = await dashboard()(
    viewer.principal,
  );
  const superadmin = isSuperadmin(viewer.principal);
  const setup = superadmin ? integrationStatus(getAdminEnv()) : null;
  const params = await searchParams;
  const viewPeriod = VIEW_PERIODS.find((p) => p.key === params["views"]) ?? VIEW_PERIODS[0];
  const viewPage = typeof params["page"] === "string" ? params["page"] : null;
  const views = superadmin
    ? await pageViewReport(pageViewStore(), new Date(), { range: viewPeriod.kind, page: viewPage })
    : null;
  const viewsHref = (next: { views?: string; page?: string | null }) => {
    const query = new URLSearchParams({ views: next.views ?? viewPeriod.key });
    const page = next.page === undefined ? viewPage : next.page;
    if (page) query.set("page", page);
    return `/?${query}#page-views`;
  };

  // One tile per thing waiting for this person; nothing is shown when it is zero.
  const actions: StatCardProps[] = [
    ...queues.map((q) => ({
      label: q.label,
      value: q.count,
      href: q.href,
      icon: "inbox" as const,
    })),
    ...(overdue.length > 0
      ? [
          {
            label: "My overdue tasks",
            value: overdue.length,
            href: "/tasks",
            icon: "clock" as const,
          },
        ]
      : []),
    ...(graduatedOfficers && graduatedOfficers.length > 0
      ? [
          {
            label: "Graduated officers still in office",
            value: graduatedOfficers.length,
            href: `/organizations/periods/${graduatedOfficers[0]?.periodId ?? ""}`,
            icon: "users" as const,
          },
        ]
      : []),
  ];
  const issues = [
    ...(setup?.integrations
      .filter((i) => !i.configured)
      .map((i) => ({ key: i.name, text: `${i.name} is off`, detail: i.missing.join(", ") })) ?? []),
    ...(setup?.messagingMode === "log"
      ? [
          {
            key: "messaging",
            text: "Messages are only logged, not sent",
            detail: "MESSAGING_MODE=live",
          },
        ]
      : []),
    ...(noLpjSecretariat
      ? [
          {
            key: "lpj",
            text: "Nobody can review LPJs — give the secretariat desk in Role Manager",
            detail: "lpj.review_secretariat",
          },
        ]
      : []),
  ];

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Dashboard</h1>
          <p className="admin-page-header__desc">
            {actions.length === 0
              ? "Nothing is waiting for you."
              : `${actions.length} ${actions.length === 1 ? "thing needs" : "things need"} your action.`}
          </p>
        </div>
      </div>

      <div className="admin-dashboard">
        {actions.length > 0 ? (
          <div className="admin-stat-grid">
            {actions.map((a) => (
              <StatCard key={a.label} {...a} />
            ))}
          </div>
        ) : null}

        {issues.length > 0 ? (
          <Card>
            <CardHeader
              title={`Setup to fix (${issues.length})`}
              subtitle={
                setup
                  ? "Set environment variables in the hosting app (docs/environment.md), never here."
                  : undefined
              }
            />
            <CardBody>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Problem</th>
                      <th>Set</th>
                    </tr>
                  </thead>
                  <tbody>
                    {issues.map((issue) => (
                      <tr key={issue.key}>
                        <td>{issue.text}</td>
                        <td>
                          <code>{issue.detail}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        ) : null}

        {views ? (
          <div id="page-views">
            <PageViewsCard report={views} period={viewPeriod} href={viewsHref} />
          </div>
        ) : null}
      </div>
    </>
  );
}
