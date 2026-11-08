import type { ReactNode } from "react";

export function AppShell(props: { title: string; children?: ReactNode }) {
  return (
    <main className="ui-shell">
      <h1 className="ui-shell-title">{props.title}</h1>
      {props.children}
    </main>
  );
}

export function StatusBadge(props: { label: string; status: "ok" | "warn" }) {
  return (
    <span data-testid="status-badge" className="ui-status" data-status={props.status}>
      {props.label}
    </span>
  );
}
