import { PageViewsControls } from "@/components/page-views-controls";
import { ViewChart } from "@/components/page-views-chart";
import { pageOptions } from "@/components/page-views-model";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

type Point = { label: string; views: number; visits: number };
export interface PageViewReport {
  page: string;
  period: string;
  daily: Point[];
  monthly: Point[];
  yearly: Point[];
  pages: ReadonlyArray<{
    page: string;
    views: number;
    visits: number;
    mobile: number;
    referrers: ReadonlyArray<{ host: string; visits: number }>;
    lastViewedAt: Date | null;
  }>;
}

export const VIEW_PERIODS = [
  {
    key: "daily",
    axis: "Date",
    kind: "day",
    label: "Daily",
    title: "Daily Page Views (Last 30 Days)",
    color: "var(--color-info)",
  },
  {
    key: "monthly",
    axis: "Month",
    kind: "month",
    label: "Monthly",
    title: "Monthly Page Views (Last 12 Months)",
    color: "var(--color-success)",
  },
  {
    key: "yearly",
    axis: "Year",
    kind: "year",
    label: "Yearly",
    title: "Yearly Page Views (Last 5 Years)",
    color: "var(--color-gold)",
  },
] as const;
export type ViewPeriod = (typeof VIEW_PERIODS)[number];

export function PageViewsCard(props: {
  report: PageViewReport;
  period: ViewPeriod;
  href: (next: { views?: string; page?: string | null }) => string;
}) {
  const { report, period, href } = props;
  const rows =
    period.key === "daily"
      ? report.daily
      : period.key === "monthly"
        ? report.monthly
        : report.yearly;
  const total = rows.reduce((sum, r) => sum + r.views, 0);
  const average = Math.round(total / rows.length);
  return (
    <Card className="admin-views">
      <CardHeader
        title={period.title}
        actions={
          <PageViewsControls
            page={report.page}
            pages={pageOptions(report.pages, report.page).map((o) => ({
              ...o,
              href: href({ page: o.value === "*" ? null : o.value }),
            }))}
            period={period.key}
            periods={VIEW_PERIODS.map((p) => ({
              value: p.key,
              label: p.label,
              href: href({ views: p.key }),
            }))}
          />
        }
      />
      <CardBody>
        <ViewChart rows={rows} line={period.key === "daily"} color={period.color} />
        <div className="admin-views__foot">
          <span>
            Total: {total.toLocaleString("en")} &nbsp; Average: {average.toLocaleString("en")} per{" "}
            {period.kind}
          </span>
          <span>{period.axis}</span>
          <span>Views = page loads · UTC</span>
        </div>
      </CardBody>
    </Card>
  );
}
