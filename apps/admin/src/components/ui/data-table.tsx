import type { ReactNode } from "react";
import { Fragment, isValidElement, type CSSProperties } from "react";
import { cardRoles, PAGE_SIZE_OPTIONS } from "../list-model";
import { ColumnMenu, type ColumnMenuProps } from "./column-menu";
import { Icon } from "./icon";
import { Select } from "./select";

function cellText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "";
}

type SortHeaderProps = ColumnMenuProps;

const sortHeaderProps = (header: ReactNode): SortHeaderProps | null =>
  isValidElement<SortHeaderProps>(header) && header.type === SortHeader ? header.props : null;

export function headerText(header: ReactNode): string {
  return typeof header === "string" ? header : (sortHeaderProps(header)?.label ?? "");
}

export const sortChoices = <T,>(columns: readonly Column<T>[]): SortHeaderProps[] =>
  columns.flatMap((col) => sortHeaderProps(col.header) ?? []);

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
  emptyState?: ReactNode;
  expandedRow?: (row: T) => ReactNode;
}

function DefaultEmpty({ text }: { text?: string | undefined }) {
  return (
    <div className="admin-empty">
      <Icon name="inbox" size={32} />
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
  emptyState,
  expandedRow,
}: DataTableProps<T>) {
  const empty = rows.length === 0;
  const roles = cardRoles(columns.map((col) => col.key));

  return (
    <div className={empty ? "admin-table-wrap admin-table-wrap--empty" : "admin-table-wrap"}>
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
          {rows.map((row, index) => {
            const expanded = expandedRow?.(row);
            return (
              <Fragment key={rowKey(row)}>
                <tr style={{ "--i": index } as CSSProperties}>
                  {columns.map((col, i) => (
                    <td
                      key={col.key}
                      data-card={roles[i]}
                      data-label={headerText(col.header) || undefined}
                      style={{ textAlign: col.align ?? "left" }}
                    >
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
        </tbody>
      </table>
      {empty ? (
        <div className="admin-table__empty" role="status">
          {emptyState ?? <DefaultEmpty text={emptyText} />}
        </div>
      ) : null}
    </div>
  );
}

export interface PaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  pageSizeOptions?: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

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
        <span className="admin-darkbar__word">Prev</span>
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
      <span className="admin-darkbar__of">of {totalPages}</span>
      <button
        type="button"
        className="admin-darkbar__btn"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
      >
        <span className="admin-darkbar__word">Next</span>
        <Icon name="chevronRight" size={14} />
      </button>
    </div>
  );
}

export function SortHeader(props: SortHeaderProps) {
  return <ColumnMenu {...props} />;
}
