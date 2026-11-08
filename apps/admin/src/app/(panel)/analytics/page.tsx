import { isSuperadmin } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { formatUtc } from "@/components/format";
import { StatCard } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireAdminViewer } from "@/server/context";
import { getAppUrls } from "@/server/env";
import { pageViewReport, pageViewStore } from "@/server/page-views";

export const instant = false;

const RANGES = [
  { key: "day", label: "Today" },
  { key: "month", label: "This month" },
  { key: "year", label: "This year" },
] as const;

type Row = { label: string; views: number; visits: number };

function Bars({ title, rows }: { title: string; rows: Row[] }) {
  const max = Math.max(1, ...rows.map((r) => r.views));
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Period</th>
                <th style={{ width: "50%" }}>Views</th>
                <th>Views</th>
                <th>Visits</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td>{r.label}</td>
                  <td aria-hidden="true">
                    <div
                      style={{
                        height: 8,
                        borderRadius: 4,
                        background: "currentColor",
                        opacity: 0.5,
                        width: `${(r.views / max) * 100}%`,
                      }}
                    />
                  </td>
                  <td>{r.views.toLocaleString("en")}</td>
                  <td>{r.visits.toLocaleString("en")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

export default async function PageViewsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminViewer("/analytics");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  if (!isSuperadmin(viewer.principal)) return <AccessMessage reason="no-access" />;

  const params = await searchParams;
  const range = RANGES.find((r) => r.key === params["range"])?.key ?? "month";
  const page = typeof params["page"] === "string" ? params["page"] : null;
  const report = await pageViewReport(pageViewStore(), new Date(), { range, page });
  const webUrl = getAppUrls().WEB_URL ?? "";
  const href = (next: { range?: string; page?: string | null }) => {
    const query = new URLSearchParams({ range: next.range ?? range });
    const p = next.page === undefined ? page : next.page;
    if (p) query.set("page", p);
    return `/analytics?${query}`;
  };
  const selected = report.page === "*" ? "the whole website" : report.page;

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Page Views</h1>
          <p className="admin-page-header__desc">
            Views of the public website (UTC days). A view is every page load; a visit counts each
            visitor once per page per day. Visible to superadmins only.
          </p>
        </div>
      </div>

      <p>
        Showing {selected}.{" "}
        {page ? <a href={href({ page: null })}>Back to the whole website</a> : null}
      </p>
      <div className="admin-stat-grid">
        <StatCard
          label="Views today"
          value={report.totals.today.toLocaleString("en")}
          icon="chart"
        />
        <StatCard label="Views this month" value={report.totals.month.toLocaleString("en")} />
        <StatCard label="Views this year" value={report.totals.year.toLocaleString("en")} />
        <StatCard label="Average per day (30 days)" value={report.averages.perDay} />
        <StatCard label="Average per month (12 months)" value={report.averages.perMonth} />
        <StatCard label="Average per year (5 years)" value={report.averages.perYear} />
      </div>

      <Card>
        <CardHeader title={`Pages · ${report.period}`} />
        <CardBody>
          <p>
            {RANGES.map((r, i) => (
              <span key={r.key}>
                {i > 0 ? " · " : ""}
                {r.key === range ? (
                  <strong>{r.label}</strong>
                ) : (
                  <a href={href({ range: r.key })}>{r.label}</a>
                )}
              </span>
            ))}
          </p>
          {report.pages.length === 0 ? (
            <p>No views in this period yet.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Views</th>
                    <th>Visits</th>
                    <th>Mobile</th>
                    <th>Desktop</th>
                    <th>Top referrers</th>
                    <th>Last viewed</th>
                  </tr>
                </thead>
                <tbody>
                  {report.pages.map((p) => (
                    <tr key={p.page}>
                      <td>
                        <a href={href({ page: p.page })}>{p.page}</a>{" "}
                        <a
                          href={`${webUrl}${p.page}`}
                          target="_blank"
                          rel="noreferrer"
                          className="admin-table__sub"
                        >
                          open
                        </a>
                      </td>
                      <td>{p.views.toLocaleString("en")}</td>
                      <td>{p.visits.toLocaleString("en")}</td>
                      <td>{p.mobile.toLocaleString("en")}</td>
                      <td>{(p.visits - p.mobile).toLocaleString("en")}</td>
                      <td>
                        {p.referrers.length === 0
                          ? "—"
                          : p.referrers
                              .slice(0, 3)
                              .map((r) => `${r.host} (${r.visits})`)
                              .join(", ")}
                      </td>
                      <td>{formatUtc(p.lastViewedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Bars title="Last 30 days" rows={report.daily} />
      <Bars title="Last 12 months" rows={report.monthly} />
      <Bars title="Last 5 years" rows={report.yearly} />
    </div>
  );
}
