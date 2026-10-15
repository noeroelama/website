import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

/** Badge tones map to `badge--*` in `apps/admin/src/app/globals.css`. */
export type BadgeTone = "success" | "warn" | "danger" | "neutral" | "primary";

export function Badge({
  tone = "neutral",
  dot = true,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`admin-badge admin-badge--${tone}`}>
      {dot ? <span className="admin-badge__dot" /> : null}
      {children}
    </span>
  );
}

export interface StatCardProps {
  label: string;
  value: ReactNode;
  icon?: IconName;
  trend?: ReactNode;
  trendDir?: "up" | "down";
  href?: string;
}

/**
 * KPI card for dashboards. If `href` is given it renders an `<a>` so the whole card is a link
 * (same-origin admin pages only). No hex values here — colours come from CSS classes / tokens.
 */
export function StatCard({ label, value, icon, trend, trendDir = "up", href }: StatCardProps) {
  const inner = (
    <>
      <span className="admin-stat-card__head">
        <span className="admin-stat-card__label">{label}</span>
        {icon ? <Icon name={icon} size={18} className="admin-stat-card__icon" /> : null}
      </span>
      <span className="admin-stat-card__value">{value}</span>
      {trend ? (
        <span className={`admin-stat-card__trend admin-stat-card__trend--${trendDir}`}>
          {trend}
        </span>
      ) : null}
    </>
  );

  if (href) {
    return (
      <a href={href} className="admin-stat-card">
        {inner}
      </a>
    );
  }

  return <div className="admin-stat-card">{inner}</div>;
}
