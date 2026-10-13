import type { ReactNode } from "react";

/**
 * Presentational only. UI components never fetch data, read env, or make
 * authorization decisions — they render what server code already decided.
 * Styling comes from `@website/ui/styles.css` (design tokens), imported once per app.
 */
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
