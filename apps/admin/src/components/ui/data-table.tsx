import type { ReactNode } from "react";
import { Fragment } from "react";
import { PAGE_SIZE_OPTIONS } from "../list-model";
import { Icon } from "./icon";
import { Select } from "./select";

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
  /** Always render this many body rows (padding with placeholders) so the
   *  table keeps its shape even when fewer records than a full page exist. */
  minRows?: number;
  /** Custom empty content. With `minRows > 0` it floats centred over a full
   *  page of blank filler rows (table height stays static); with no `minRows`
   *  the compact `.admin-empty` block is rendered instead. */
  emptyState?: ReactNode;
  /** When non-null, render a full-width row underneath `row` (e.g. an
   *  expandable detail panel). The caller owns the expansion state. */
  expandedRow?: (row: T) => ReactNode;
}

/** Compact standalone empty block, used for tables without a min height. */
function DefaultEmpty({ text }: { text?: string | undefined }) {
  return (
    <div className="admin-empty">
      <span className="admin-empty__icon" aria-hidden="true">
        🗂️
      </span>
      <span className="admin-empty__title">{text ?? "No data"}</span>
      <span className="admin-empty__hint">No data available yet.</span>
    </div>
  );
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  emptyText,
  hideHeader,
  minRows = 0,
  emptyState,
  expandedRow,
}: DataTableProps<T>) {
  /* Without a min height the old compact empty block is fine; with minRows the
     caller wants the table shape preserved even at zero records, so the empty
     message floats centred over a full page of blank filler rows. */
  if (rows.length === 0 && minRows === 0) {
    return <DefaultEmpty text={emptyText} />;
  }

  const emptyOverlay = rows.length === 0 ? (emptyState ?? <DefaultEmpty text={emptyText} />) : null;
  const fillers = emptyOverlay ? 0 : Math.max(0, minRows - Math.max(1, rows.length));

  return (
    <div className={emptyOverlay ? "admin-table-wrap admin-table-wrap--empty" : "admin-table-wrap"}>
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
          {emptyOverlay
            ? Array.from({ length: minRows }, (_, i) => (
                <tr key={`fill-${i}`} className="admin-table__placeholder" aria-hidden="true">
                  <td colSpan={columns.length}>&nbsp;</td>
                </tr>
              ))
            : null}
          {rows.map((row) => {
            const expanded = expandedRow?.(row);
            return (
              <Fragment key={rowKey(row)}>
                <tr>
                  {columns.map((col) => (
                    <td key={col.key} style={{ textAlign: col.align ?? "left" }}>
                      {col.render
                        ? col.render(row)
                        : cellText((row as Record<string, unknown>)[col.key])}
                    </td>
                  ))}
                </tr>
                {expanded ? (
                  <tr className="admin-table__expanded-row">
                    <td colSpan={columns.length}>{expanded}</td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
          {fillers > 0
            ? Array.from({ length: fillers }, (_, i) => (
                <tr key={`fill-${i}`} className="admin-table__placeholder" aria-hidden="true">
                  <td colSpan={columns.length}>&nbsp;</td>
                </tr>
              ))
            : null}
        </tbody>
      </table>
      {emptyOverlay ? (
        <div className="admin-table__overlay" role="status">
          {emptyOverlay}
        </div>
      ) : null}
    </div>
  );
}

export interface PaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  /** Rows-per-page choices (default 10 / 20 / 50). */
  pageSizeOptions?: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

/**
 * Footer of the dark list pages: "Showing 1–10 of 112", rows per page and a sliding window of
 * five page numbers (`.admin-darkbar` in globals.css).
 */
export function Pagination({
  page,
  pageSize,
  totalItems,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);
  const first = Math.max(1, Math.min(page - 2, totalPages - 4));
  const pages: number[] = [];
  for (let p = first; p <= Math.min(totalPages, first + 4); p++) pages.push(p);

  return (
    <div className="admin-darkbar">
      <span className="admin-darkbar__info">
        Showing {start}–{end} of {totalItems}
      </span>
      <span className="admin-darkbar__info">
        Rows per page
        <Select
          className="admin-darkbar__select"
          aria-label="Rows per page"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
        >
          {pageSizeOptions.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </span>
      <span className="admin-darkbar__spacer" />
      <button
        type="button"
        className="admin-darkbar__btn"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
      >
        <Icon name="chevronLeft" size={14} />
      </button>
      {pages.map((p) => (
        <button
          type="button"
          key={p}
          className={`admin-darkbar__btn${p === page ? " admin-darkbar__btn--active" : ""}`}
          aria-current={p === page ? "page" : undefined}
          onClick={() => onPageChange(p)}
        >
          {p}
        </button>
      ))}
      <button
        type="button"
        className="admin-darkbar__btn"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
      >
        <Icon name="chevronRight" size={14} />
      </button>
    </div>
  );
}

/** Sortable table header: label + arrow icon. Active column shows a filled arrow. */
export function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`admin-th-sort${active ? " admin-th-sort--active" : ""}`}
      onClick={onClick}
    >
      <span>{label}</span>
      <Icon name={active ? (dir === "asc" ? "arrowUp" : "arrowDown") : "sort"} size={12} />
    </button>
  );
}
