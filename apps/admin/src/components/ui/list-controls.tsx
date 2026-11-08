"use client";

import {
  Children,
  Fragment,
  isValidElement,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { ActionFailure } from "../action-message";
import {
  columnValues,
  countText,
  emptyText,
  filterRows,
  nextSort,
  pageSlice,
  runEach,
  sortRows,
  sortSummary,
  toggled,
  withIds,
  type ColumnFilters,
  type SortState,
} from "../list-model";
import { Button } from "./button";
import { Card, CardBody } from "./card";
import { DataTable, Pagination, SortHeader, sortChoices, type Column } from "./data-table";
import { Icon, type IconName } from "./icon";

export function useListTable<T extends { id: string }, K extends string>(
  rows: readonly T[],
  sortValue: (row: T, key: K) => string | number,
  initialSort: SortState<K> = { key: null, dir: "asc" },
  filterText: (row: T, key: K) => string = (row, key) => String(sortValue(row, key)),
) {
  const [sort, setSort] = useState<SortState<K>>(initialSort);
  const [filters, setFilters] = useState<ColumnFilters<K>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  /* eslint-disable react-hooks/exhaustive-deps */
  const shown = useMemo(() => filterRows(rows, filters, filterText), [rows, filters]);
  const sorted = useMemo(() => {
    const key = sort.key;
    return key === null ? [...shown] : sortRows(shown, (row) => sortValue(row, key), sort.dir);
  }, [shown, sort]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const view = pageSlice(sorted, page, pageSize);
  const pageIds = view.rows.map((row) => row.id);
  const pageAll = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const allSelected = shown.length > 0 && shown.every((row) => selected.has(row.id));

  return {
    sort,
    onSort: (key: K) => setSort((current) => nextSort(current, key)),
    header: (key: K, label: string) => (
      <SortHeader
        label={label}
        active={sort.key === key}
        dir={sort.dir}
        onSort={(dir) => setSort({ key, dir })}
        filter={{
          values: columnValues(
            rows,
            (row) => filterText(row, key),
            (row) => sortValue(row, key),
          ),
          hidden: filters[key] ?? new Set<string>(),
          onChange: (hidden) => {
            setFilters((current) => ({ ...current, [key]: hidden }));
            setPage(1);
          },
        }}
      />
    ),
    sorted,
    filterCount: Object.values(filters).filter((hidden) => (hidden as ReadonlySet<string>).size > 0)
      .length,
    clearFilters: () => setFilters({}),
    page: view.page,
    setPage,
    pageSize,
    setPageSize: (size: number) => {
      setPageSize(size);
      setPage(1);
    },
    pageRows: view.rows,
    selected,
    clearSelection: () => setSelected(new Set()),
    toggle: (id: string) => setSelected((current) => toggled(current, id)),
    togglePage: () => setSelected((current) => withIds(current, pageIds, !pageAll)),
    toggleAll: () =>
      setSelected((current) =>
        withIds(
          current,
          shown.map((row) => row.id),
          !allSelected,
        ),
      ),
    pageAll,
    pageSome: pageIds.some((id) => selected.has(id)),
    allSelected,
  };
}

export function useBulkActions(options: {
  noun: string;
  show: (text: string) => void;
  onFailure: (failure: ActionFailure) => void;
  onFinish: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const run = async <T,>(
    rows: readonly T[],
    action: (row: T) => Promise<{ ok: true } | ActionFailure>,
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
        {menuEntries(children).map((child, i) => (
          <div
            key={i}
            role="none"
            className="admin-row-menu__row"
            style={{ "--i": i } as CSSProperties}
          >
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}

function menuEntries(nodes: ReactNode): ReactNode[] {
  return Children.toArray(nodes).flatMap((node) =>
    isValidElement<{ children?: ReactNode }>(node) && node.type === Fragment
      ? menuEntries(node.props.children)
      : [node],
  );
}

export function StatusMenu<K extends string>({
  options,
  value,
  onSelect,
}: {
  options: readonly { key: K; label: string }[];
  value: K;
  onSelect: (key: K) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="admin-row-menu">
      {open ? <div className="admin-row-menu__backdrop" onClick={() => setOpen(false)} /> : null}
      <button
        type="button"
        className="admin-newsletter-status"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Status <strong>{options.find((o) => o.key === value)?.label}</strong>
        <Icon name="chevronDown" size={14} />
      </button>
      {open ? (
        <div
          className="admin-row-menu__panel admin-newsletter-status__menu"
          role="menu"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          {options.map((o, i) => (
            <button
              key={o.key}
              type="button"
              role="menuitemradio"
              style={{ "--i": i } as CSSProperties}
              aria-checked={value === o.key}
              className="admin-row-menu__item"
              onClick={() => {
                onSelect(o.key);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

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
  className?: string;
  danger?: boolean;
  disabled?: boolean;
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

export const MenuDivider = () => <div className="admin-row-menu__divider" role="separator" />;

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

export function SortMenu<T>({ columns }: { columns: Column<T>[] }) {
  const choices = sortChoices(columns);
  if (choices.length === 0) return null;
  return (
    <div className="admin-sort-menu" role="group" aria-label="Sort and filter">
      {choices.map((choice) => (
        <SortHeader key={choice.label} {...choice} />
      ))}
    </div>
  );
}

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

export function ListCard<T extends { id: string }>({
  table,
  noun,
  columns,
  empty,
  bulkActions,
  expandedRow,
  children,
}: {
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
    | "sorted"
  >;
  noun: string;
  columns: Column<T>[];
  empty: ReactNode;
  bulkActions?: ReactNode;
  expandedRow?: (row: T) => ReactNode;
  children?: ReactNode;
}) {
  const total = table.sorted.length;
  return (
    <Card className="admin-events-card admin-list-card">
      <CardBody flush>
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
