import type { HTMLAttributes, ReactNode } from "react";

/**
 * Admin card primitives. Presentational only — styles come from `admin-card*` classes in
 * `apps/admin/src/app/globals.css` (design tokens; no hex here).
 */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className, ...rest }: CardProps) {
  return (
    <div className={["admin-card", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}

export interface CardHeaderProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}

export function CardHeader({ title, subtitle, actions, children }: CardHeaderProps) {
  return (
    <div className="admin-card__header">
      <div>
        {title ? <div className="admin-card__title">{title}</div> : null}
        {subtitle ? <div className="admin-card__subtitle">{subtitle}</div> : null}
        {children}
      </div>
      {actions ? <div className="admin-card__actions">{actions}</div> : null}
    </div>
  );
}

export interface CardBodyProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  flush?: boolean;
}

export function CardBody({ children, flush, className, ...rest }: CardBodyProps) {
  return (
    <div
      className={[flush ? "admin-card__body--flush" : "admin-card__body", className]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </div>
  );
}
