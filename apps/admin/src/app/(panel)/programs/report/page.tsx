import { formatMoney, PROGRAM_STATUSES, type BudgetRow } from "@website/domain/programs";
import { AccessMessage } from "@/components/access-message";
import { PeriodSwitch } from "@/components/program-ui";
import { StatCard } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { label, PROGRAM_STATUS_LABELS } from "@/labels";
import { requireAdminViewer } from "@/server/context";
import { adminReads } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

/**
 * Period report card (E5): computed on every request, nothing stored. Totals of the whole
 * period (programmes are open to every officer, DECISIONS §24); budgets per currency.
 */
export default async function ReportCardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminViewer("/programs/report", "programs.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  const asked = (await searchParams)["period"];
  const periods = await adminReads.listPeriods();
  const period =
    periods.find((p) => p.id === asked) ?? periods.find((p) => p.status === "active") ?? periods[0];
  if (!period) return <AccessMessage reason="no-access" />;
  const [card, units] = await Promise.all([
    adminReads.periodReportCard(period.id),
    adminReads.listOrgUnits(period.id),
  ]);
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const { okr, programmes, budget, lpj } = card;
  return (
    <div>
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">Report card</h1>
          <p className="admin-page-header__desc">
            Period {period.name} · computed now, never stored
          </p>
        </div>
        <div className="admin-page-header__actions">
          <PeriodSwitch
            path="/programs/report"
            current={period.id}
            periods={periods.map((p) => ({ id: p.id, name: p.name }))}
          />
          <Button
            variant="outline"
            size="sm"
            icon="chevronLeft"
            href={`/programs?period=${period.id}`}
          >
            Back
          </Button>
        </div>
      </div>
      <div className="admin-stat-grid">
        <StatCard label="OKR achievement" value={`${okr.achievementPercent}%`} icon="chart" />
        <StatCard
          label="Programme completion"
          value={`${programmes.completionPercent}%`}
          icon="check"
        />
        <StatCard label="Programmes at risk" value={programmes.troubled} icon="warning" />
        <StatCard label="LPJ overdue" value={lpj.overdue} icon="clock" />
      </div>
      <Card>
        <CardHeader
          title="Programmes"
          subtitle="Completion = finished ÷ approved, running and finished (proposals and cancelled left out)."
        />
        <CardBody>
          <p>
            {PROGRAM_STATUSES.map(
              (s) => `${label(PROGRAM_STATUS_LABELS, s)}: ${programmes.counts[s]}`,
            ).join(" · ")}{" "}
            · Total: {programmes.total}
          </p>
          <p>
            LPJ waiting for review: {lpj.submitted} · approved: {lpj.approved} · overdue:{" "}
            {lpj.overdue}
          </p>
        </CardBody>
      </Card>
      <Card className="admin-events-card">
        <CardHeader
          title="Budget absorption"
          subtitle="Per currency, never converted. Spent = approved LPJs only."
        />
        <CardBody flush>
          <DataTable<BudgetRow>
            rows={[...budget]}
            rowKey={(r) => r.currency}
            emptyText="No budget lines yet."
            columns={[
              { key: "currency", header: "Currency", render: (r) => r.currency },
              { key: "planned", header: "Planned", render: (r) => formatMoney(r.planned) },
              { key: "realized", header: "Spent", render: (r) => formatMoney(r.realized) },
              {
                key: "absorption",
                header: "Absorption",
                render: (r) => (r.absorptionPercent === null ? "—" : `${r.absorptionPercent}%`),
              },
            ]}
          />
        </CardBody>
      </Card>
      <Card className="admin-events-card">
        <CardHeader title="OKR" />
        <CardBody flush>
          <DataTable
            rows={[...okr.objectives]}
            rowKey={(o) => o.id}
            emptyText="No objectives yet."
            columns={[
              {
                key: "title",
                header: "Objective",
                render: (o) => (
                  <div>
                    <div className="admin-table__title">{o.title}</div>
                    <div className="admin-table__sub">
                      {o.orgUnitId ? (unitName.get(o.orgUnitId) ?? "") : "Region"} · {o.keyResults}{" "}
                      key results
                    </div>
                  </div>
                ),
              },
              { key: "percent", header: "Achieved", render: (o) => `${o.percent}%` },
            ]}
          />
        </CardBody>
      </Card>
    </div>
  );
}
