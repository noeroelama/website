import { dashboardStats } from "@/data/mock/dashboard-stats";
import { Card, CardBody } from "@/components/ui/card";
import { StatCard } from "@/components/ui/badge";

/**
 * Dashboard content (server-rendered; no interaction). KPI cards link to their admin pages,
 * then a welcome card describes what the panel manages.
 */
export function DashboardPage() {
  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Dashboard</h1>
          <p className="admin-page-header__desc">
            Overview of content performance and latest PPIDK Asiania activity.
          </p>
        </div>
      </div>

      <div className="admin-stat-grid">
        {dashboardStats.map((stat) => (
          <StatCard key={stat.label} {...stat} />
        ))}
      </div>

      <Card className="admin-welcome-card">
        <CardBody style={{ width: "100%" }}>
          <div className="admin-welcome">
            <div className="admin-welcome__avatar" aria-hidden="true">
              A
            </div>
            <div className="admin-welcome__text">
              <div className="admin-card__title">Welcome back, Admin PPIDK</div>
              <div className="admin-card__subtitle">Administrator</div>
              <p className="admin-welcome__body">
                You are signed in as an Administrator for the PPIDK Asiania admin panel. From here
                you can manage articles, events, galleries, newsletters, and organizations — all in
                one place.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
