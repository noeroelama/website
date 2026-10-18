import type { ReactNode } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatCard, type StatCardProps } from "@/components/ui/badge";

/** One recent audit entry, already formatted on the server. */
export interface DashboardAuditRow {
  id: string;
  when: string;
  who: string;
  what: string;
}

/**
 * Dashboard content (server-rendered; no interaction). Counters only for the pages the viewer
 * can read (src/server/dashboard.ts); the newest audit entries only with audit.read.
 */
export function DashboardPage(props: {
  name: string;
  counters: StatCardProps[];
  audit: DashboardAuditRow[] | null;
  /** Later steps add "waiting for my action" queues here. */
  children?: ReactNode;
}) {
  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Dashboard</h1>
          <p className="admin-page-header__desc">Overview of the content you manage.</p>
        </div>
      </div>

      {props.counters.length > 0 ? (
        <div className="admin-stat-grid">
          {props.counters.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </div>
      ) : null}

      <Card className="admin-welcome-card">
        <CardBody style={{ width: "100%" }}>
          <div className="admin-welcome">
            <div className="admin-welcome__avatar" aria-hidden="true">
              {props.name.slice(0, 1).toUpperCase() || "A"}
            </div>
            <div className="admin-welcome__text">
              <div className="admin-card__title">Welcome back, {props.name}</div>
              <p className="admin-welcome__body">
                The side panel shows the pages your roles allow. Changes you make are recorded in
                the Audit Log.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {props.audit ? (
        <Card>
          <CardHeader title="Latest changes" />
          <CardBody>
            {props.audit.length === 0 ? (
              <p>No changes yet.</p>
            ) : (
              <ul>
                {props.audit.map((row) => (
                  <li key={row.id}>
                    <span className="admin-table__sub">{row.when}</span> — {row.who}: {row.what}
                  </li>
                ))}
              </ul>
            )}
            <a href="/audit">Open the Audit Log</a>
          </CardBody>
        </Card>
      ) : null}
      {props.children}
    </>
  );
}
