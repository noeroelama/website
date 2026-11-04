"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ActionFailure } from "../action-message";
import {
  countText,
  emptyText,
  nextSort,
  pageSlice,
  runEach,
  sortRows,
  sortSummary,
  toggled,
  withIds,
  type SortState,
} from "../list-model";
import { Button } from "./button";
import { Card, CardBody } from "./card";
import { DataTable, Pagination, sortChoices, type Column } from "./data-table";
import { Icon, type IconName } from "./icon";

/*
 * The common parts of the dark list pages (Event, Gallery, Article, Newsletter, Audit Log):
 * header search box and Filters button, tabs, the list card (filter panel, table, bulk bar or
 * pagination), row checkbox, row "more" menu, empty message, plus the hooks for the table state
 * and the bulk server actions. Table, pagination and sortable headers are in `data-table.tsx`;
 * the rules are in `../list-model.ts`.
 *
 * Components that change often while you work (the search text, an open row menu) keep their
 * own state, so typing or opening a menu re-renders only that part, not the whole table.
 */

/**
 * State of one dark list table (rules in `../list-model.ts`): the sorted column, the page and
 * rows per page, and the selected rows (by id). `rows` are the filtered rows of the page;
 * `sortValue` must not change between renders (declare it outside the component).
 */
export function useListTable<T extends { id: string }, K extends string>(
  rows: readonly T[],
  sortValue: (row: T, key: K) => string | number,
  /** Sorted column before the first header click (default: the rows' own order). */
  initialSort: SortState<K> = { key: null, dir: "asc" },
) {
  const [sort, setSort] = useState<SortState<K>>(initialSort);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const sorted = useMemo(() => {
    const key = sort.key;
    return key === null ? rows : sortRows(rows, (row) => sortValue(row, key), sort.dir);
    // sortValue is a module-level function (see above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  const view = pageSlice(sorted, page, pageSize);
  const pageIds = view.rows.map((row) => row.id);
  const pageAll = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));

  return {
    sort,
    onSort: (key: K) => setSort((current) => nextSort(current, key)),
    sorted,
    page: view.page,
    setPage,
    pageSize,
    /** A new page size starts again at page 1. */
    setPageSize: (size: number) => {
      setPageSize(size);
      setPage(1);
    },
    pageRows: view.rows,
    selected,
    clearSelection: () => setSelected(new Set()),
    toggle: (id: string) => setSelected((current) => toggled(current, id)),
    /** Header checkbox: select (or unselect) the rows of this page. */
    togglePage: () => setSelected((current) => withIds(current, pageIds, !pageAll)),
    /** Bulk bar: select (or unselect) every row that matches the filters. */
    toggleAll: () =>
      setSelected((current) =>
        withIds(
          current,
          rows.map((row) => row.id),
          !allSelected,
        ),
      ),
    pageAll,
    pageSome: pageIds.some((id) => selected.has(id)),
    allSelected,
  };
}

/**
 * Row and bulk server actions of a list page: runs one action per row (`runEach`), then
 * re-reads the page and reports "3 events published" — or the first refusal.
 */
export function useBulkActions(options: {
  /** Singular noun for the message ("event" → "3 events deleted"). */
  noun: string;
  show: (text: string) => void;
  onFailure: (failure: ActionFailure) => void;
  /** Runs after every batch (e.g. clear the selection). */
  onFinish: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const run = async <T,>(
    rows: readonly T[],
    action: (row: T) => Promise<{ ok: true } | ActionFailure>,
    /** "deleted" → "3 events deleted", or the whole message from the count. */
    done: string | ((count: number) => string),
  ) => {
    setBusy(true);
    const { count, failure } = await runEach(rows, action);
    setBusy(false);
    options.onFinish();
    router.refresh();
    if (failure) options.onFailure(failure);
    else
      options.show(
        typeof done === "string" ? `${countText(count, options.noun)} ${done}` : done(count),
      );
  };

  return { busy, setBusy, run };
}

/**
 * Header search: the text is applied on Search / Enter (`onSearch`); emptying the box clears
 * the search at once. Give it a new `key` to empty it from outside (e.g. "Clear filters").
 */
export function SearchBox({
  placeholder,
  label,
  onSearch,
}: {
  placeholder: string;
  label: string;
  onSearch: (query: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <form
      className="admin-searchbox"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(text);
      }}
    >
      <span className="admin-searchbox__icon" aria-hidden="true">
        <Icon name="search" size={16} />
      </span>
      <input
        className="admin-searchbox__input"
        type="search"
        placeholder={placeholder}
        aria-label={label}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          if (event.target.value === "") onSearch("");
        }}
      />
      <button type="submit" className="admin-searchbox__submit">
        Search
      </button>
    </form>
  );
}

/** Header "Filters" button with the number of filters that are on. */
export function FiltersButton({
  count,
  open,
  onToggle,
}: {
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      icon="filter"
      className="admin-filters-btn"
      aria-label="Filters"
      onClick={onToggle}
      aria-expanded={open}
    >
      <span className="admin-filters-btn__label">Filters</span>
      {count > 0 ? (
        <span className="admin-filter-count" aria-label={`${count} on`}>
          {count}
        </span>
      ) : null}
    </Button>
  );
}

/** Tabs above the table (All / Upcoming / …), each with an optional count. */
export function Tabs<K extends string>({
  label,
  tabs,
  active,
  onSelect,
}: {
  label: string;
  tabs: readonly { key: K; label: string; count?: number }[];
  active: K;
  onSelect: (key: K) => void;
}) {
  // Mouse drag scrolls the row sideways (touch and trackpads scroll natively). A drag of more
  // than a few pixels is not a click, so letting go over a tab does not select it.
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  return (
    <div
      className="admin-tabs"
      role="tablist"
      aria-label={label}
      onPointerDown={(event) => {
        if (event.pointerType !== "mouse" || event.button !== 0) return;
        drag.current = { x: event.clientX, left: event.currentTarget.scrollLeft, moved: false };
      }}
      onPointerMove={(event) => {
        const state = drag.current;
        if (!state || event.buttons !== 1) return;
        const dx = event.clientX - state.x;
        if (!state.moved && Math.abs(dx) < 5) return;
        if (!state.moved) {
          state.moved = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.classList.add("admin-tabs--dragging");
        }
        event.currentTarget.scrollLeft = state.left - dx;
      }}
      onPointerUp={(event) => {
        event.currentTarget.classList.remove("admin-tabs--dragging");
        if (!drag.current?.moved) drag.current = null;
      }}
      onClickCapture={(event) => {
        if (!drag.current?.moved) return;
        drag.current = null;
        event.stopPropagation();
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          role="tab"
          aria-selected={active === tab.key}
          className={`admin-tabs__btn${active === tab.key ? " admin-tabs__btn--active" : ""}`}
          onClick={() => onSelect(tab.key)}
        >
          {tab.label}
          {tab.count !== undefined ? <span className="admin-tabs__count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Row / header checkbox; `indeterminate` shows the dash of a partial selection. */
export function SelectCheckbox({
  label,
  checked,
  indeterminate = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
}) {
  return (
    <label className="admin-checkbox">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        onChange={onChange}
        className="admin-table__checkbox"
      />
      <span aria-hidden="true" />
    </label>
  );
}

/**
 * Row "more" menu (⋯). Choosing an entry closes it; so does a click outside. The entries are
 * always in the page: closed they are hidden, but on a phone the card shows them as its buttons.
 */
export function RowMenu({
  children,
  icon = "more",
  label = "More actions",
  className = "",
}: {
  children: ReactNode;
  icon?: IconName;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`admin-row-menu ${className}`.trim()}>
      {open ? <div className="admin-row-menu__backdrop" onClick={() => setOpen(false)} /> : null}
      <Button
        variant="ghost"
        size="icon"
        icon={icon}
        aria-label={label}
        title={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      />
      <div
        className={`admin-row-menu__panel${open ? "" : " admin-row-menu__panel--closed"}`}
        role="menu"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("[role=menuitem]")) setOpen(false);
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** One entry of a `RowMenu`. */
export function MenuItem({
  icon,
  danger = false,
  disabled = false,
  title,
  className = "",
  onClick,
  children,
}: {
  icon: IconName;
  /** Extra class (e.g. `admin-row-menu__item--phone`, shown on a phone only). */
  className?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Tooltip, e.g. why the entry is disabled. */
  title?: string | undefined;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`admin-row-menu__item${danger ? " admin-row-menu__item--danger" : ""} ${className}`.trim()}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      <Icon name={icon} size={14} /> {children}
    </button>
  );
}

/** Line above the destructive entry of a `RowMenu`. */
export const MenuDivider = () => <div className="admin-row-menu__divider" role="separator" />;

/**
 * Bar shown instead of the pagination while rows are selected: "3 selected", "Select all N
 * …" and the page's bulk buttons (`children`).
 */
export function BulkBar({
  count,
  total,
  noun,
  allSelected,
  onToggleAll,
  children,
}: {
  count: number;
  total: number;
  noun: string;
  allSelected: boolean;
  onToggleAll: () => void;
  children: ReactNode;
}) {
  return (
    <div className="admin-bulkbar">
      <span className="admin-bulkbar__summary">
        <SelectCheckbox
          label={`Select all matching ${noun}s`}
          checked={allSelected}
          indeterminate={count > 0 && !allSelected}
          onChange={onToggleAll}
        />
        {count} selected
      </span>
      <button type="button" className="admin-bulkbar__select-all" onClick={onToggleAll}>
        Select all {countText(total, noun)}
      </button>
      <div className="admin-bulkbar__actions">{children}</div>
    </div>
  );
}

/**
 * Empty table message: why it is empty (search, filters, no records yet), "Clear Filters"
 * while something is filtered, and the page's Add button.
 */
export function ListEmpty({
  noun,
  query,
  filters,
  emptyHint,
  onClear,
  addLabel,
  onAdd,
}: {
  noun: string;
  query: string;
  filters: number;
  emptyHint: string;
  onClear: () => void;
  /** Omit (or no `onAdd`) when the viewer cannot add. */
  addLabel?: string;
  onAdd?: (() => void) | null;
}) {
  const { title, hint } = emptyText({ noun, query, filters, emptyHint });
  return (
    <div className="admin-empty admin-empty--stack">
      <span className="admin-empty__title">{title}</span>
      <span className="admin-empty__hint">{hint}</span>
      <span className="admin-empty__actions">
        {query.trim() || filters > 0 ? (
          <Button variant="outline" size="sm" icon="x" onClick={onClear}>
            Clear Filters
          </Button>
        ) : null}
        {addLabel && onAdd ? (
          <Button variant="primary" size="sm" icon="plus" onClick={onAdd}>
            {addLabel}
          </Button>
        ) : null}
      </span>
    </div>
  );
}

/**
 * Sort button of the phone's search row (`globals.css` "Mobile list cards"; hidden on a wide
 * screen, where the column headers sort). Put it in the page header, next to the search box.
 */
export function SortMenu<T>({ columns }: { columns: Column<T>[] }) {
  const choices = sortChoices(columns);
  if (choices.length === 0) return null;
  return (
    <RowMenu icon="sort" label="Sort by" className="admin-sort-menu">
      {choices.map((choice) => (
        <MenuItem
          key={choice.label}
          icon={choice.active ? (choice.dir === "asc" ? "arrowUp" : "arrowDown") : "sort"}
          onClick={choice.onClick}
        >
          {choice.label}
        </MenuItem>
      ))}
    </RowMenu>
  );
}

/**
 * Phone only (hidden on a wide screen): "112 events · Newest first", and "Select" (this page) /
 * "Unselect" + "Select all" while rows are selected ("3 of 5 selected").
 */
function ListSummary<T extends { id: string }>({
  table,
  total,
  noun,
  columns,
  selectable,
}: {
  table: Pick<
    ReturnType<typeof useListTable<T, string>>,
    "pageRows" | "selected" | "allSelected" | "togglePage" | "toggleAll" | "clearSelection"
  >;
  total: number;
  noun: string;
  columns: Column<T>[];
  selectable: boolean;
}) {
  const active = sortChoices(columns).find((choice) => choice.active);
  const picked = table.selected.size;
  return (
    <div className="admin-list-summary">
      <span className="admin-list-summary__count">
        {picked > 0
          ? `${picked} of ${Math.max(picked, table.pageRows.length)} selected`
          : `${countText(total, noun)}${active ? ` · ${sortSummary(active.label, active.dir)}` : ""}`}
      </span>
      {selectable && total > 0 ? (
        <>
          <button
            type="button"
            className="admin-list-summary__btn"
            onClick={picked > 0 ? table.clearSelection : table.togglePage}
          >
            {picked > 0 ? "Unselect" : "Select"}
          </button>
          {picked > 0 && !table.allSelected ? (
            <button type="button" className="admin-list-summary__btn" onClick={table.toggleAll}>
              Select all
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * The list card: optional filter panel, the table (fills the screen height; the empty message
 * sits in its middle), then the bulk bar while rows are selected, else the pagination.
 */
export function ListCard<T extends { id: string }>({
  table,
  total,
  noun,
  columns,
  filters,
  empty,
  bulkActions,
  expandedRow,
  children,
}: {
  /** From `useListTable`. */
  table: Pick<
    ReturnType<typeof useListTable<T, string>>,
    | "pageRows"
    | "pageSize"
    | "page"
    | "setPage"
    | "setPageSize"
    | "selected"
    | "allSelected"
    | "toggleAll"
    | "togglePage"
    | "clearSelection"
  >;
  /** Rows that match the filters (all pages). */
  total: number;
  noun: string;
  columns: Column<T>[];
  /** The filter panel, when open. */
  filters?: ReactNode;
  empty: ReactNode;
  /** Buttons of the bulk bar; without them the list has no bulk bar. */
  bulkActions?: ReactNode;
  expandedRow?: (row: T) => ReactNode;
  /** Shown under the pagination (e.g. a note). */
  children?: ReactNode;
}) {
  return (
    <Card className="admin-events-card admin-list-card">
      <CardBody flush>
        {filters}
        <ListSummary
          table={table}
          total={total}
          noun={noun}
          columns={columns}
          selectable={Boolean(bulkActions)}
        />
        <DataTable
          columns={columns}
          rows={table.pageRows}
          rowKey={(row) => row.id}
          emptyState={empty}
          {...(expandedRow ? { expandedRow } : {})}
        />
        {bulkActions && table.selected.size > 0 ? (
          <BulkBar
            count={table.selected.size}
            total={total}
            noun={noun}
            allSelected={table.allSelected}
            onToggleAll={table.toggleAll}
          >
            {bulkActions}
          </BulkBar>
        ) : (
          <Pagination
            page={table.page}
            pageSize={table.pageSize}
            totalItems={total}
            onPageChange={table.setPage}
            onPageSizeChange={table.setPageSize}
          />
        )}
        {children}
      </CardBody>
    </Card>
  );
}
