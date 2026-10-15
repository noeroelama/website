import type { ReactNode } from "react";
import { Icon } from "./icon";

/** Render a raw cell value safely: strings/numbers pass through, others fall back to empty. */
function cellText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "";
}

/**
 * Generic admin data table + pagination. Presentational only; state (page, pageSize, sorting…)
 * lives in the caller. Styling via `admin-table*` classes in globals.css.
 */

export interface Column<T> {
  key: string;
  header: ReactNode;
  render?: (row: T) => ReactNode;
  width?: string;
  align?: "left" | "center" | "right";
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  emptyText?: string;
  hideHeader?: boolean;
}

export function DataTable<T>({ columns, rows, rowKey, emptyText, hideHeader }: DataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div className="admin-empty">
        <span className="admin-empty__icon" aria-hidden="true">
          🗂️
        </span>
        <span className="admin-empty__title">{emptyText ?? "No data"}</span>
        <span className="admin-empty__hint">No data available yet.</span>
      </div>
    );
  }

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        {!hideHeader ? (
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} style={{ width: col.width, textAlign: col.align ?? "left" }}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((col) => (
                <td key={col.key} style={{ textAlign: col.align ?? "left" }}>
                  {col.render ? col.render(row) : cellText((row as Record<string, unknown>)[col.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onChange: (page: number) => void;
}

/** Page numbers with ellipsis windowing; returns null when there is only one page. */
export function Pagination({ page, totalPages, totalItems, pageSize, onChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  const pages: number[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - page) <= 1) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== -1) {
      pages.push(-1);
    }
  }

  return (
    <div className="admin-pagination">
      <span className="admin-pagination__info">
        {start}–{end} of {totalItems}
      </span>
      <button
        type="button"
        className="admin-pagination__btn"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="Previous"
      >
        <Icon name="chevronLeft" size={16} />
      </button>
      {pages.map((p, idx) =>
        p === -1 ? (
          <span key={`ellipsis-${idx}`} className="admin-pagination__info">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            className={`admin-pagination__btn${p === page ? " admin-pagination__btn--active" : ""}`}
            onClick={() => onChange(p)}
          >
            {p}
          </button>
        ),
      )}
      <button
        type="button"
        className="admin-pagination__btn"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        aria-label="Next"
      >
        <Icon name="chevronRight" size={16} />
      </button>
    </div>
  );
}
