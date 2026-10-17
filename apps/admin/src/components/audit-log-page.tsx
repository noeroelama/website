"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Icon } from "@/components/ui/icon";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import {
  AUDIT_ACTION_OPTIONS,
  AUDIT_ENTITY_LABELS,
  AUDIT_NOW,
  AUDIT_RANGE_OPTIONS,
  INITIAL_AUDIT,
  PAGE_SIZE_OPTIONS,
  daysLeft,
  formatAuditDate,
  timeAgo,
  type AuditActionFilter,
  type AuditEntry,
  type AuditEntity,
  type AuditFieldChange,
  type AuditRange,
} from "@/data/mock/audit";

/* ==================================================================
   Audit Log — banded table of admin actions with an expandable
   structured-diff row and a Revert action that restores soft-deleted
   content (events, gallery, articles, newsletter, organizations)
   within the 14-day window. Ported from the Figma "AUDIT LOG ADMIN"
   screen; colours come from the shared design tokens.
   ================================================================== */

/** The six list tabs: all entities, then one tab per content kind. */
type EntityTab = "all" | AuditEntity;

const TAB_DEFS: ReadonlyArray<{ key: EntityTab; label: string }> = [
  { key: "all", label: "All" },
  ...(Object.entries(AUDIT_ENTITY_LABELS) as Array<[AuditEntity, string]>).map(
    ([key, label]) => ({ key, label }) as const,
  ),
];

/** One actor filter: the five actors shown in seed data + "Anyone". */
const USER_OPTIONS = [
  { key: "anyone", label: "Anyone" },
  ...[...new Set(INITIAL_AUDIT.map((e) => e.actor.name))].map((name) => ({
    key: name,
    label: name,
  })),
] as const;

/** Sortable audit-table columns (expand, code and revert are never sorted). */
type SortKey = "date" | "user" | "action";

/** Sortable table header: label + arrow icon. Active column shows a filled arrow. */
function SortHeader({
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

export function AuditLogPage() {
  const pathname = usePathname();
  // key={pathname} remounts the page when the audit route is (re)entered, so
  // tabs/filters/searches reset to their initial state on every visit.
  return <AuditLogList key={pathname} />;
}

/** One side (Before/After) of a diff row: renders rich word parts (removed in
 *  red/struck, added green) or a photo strip sized to the recorded counts. */
function DiffSide({ c, side }: { c: AuditFieldChange; side: "before" | "after" }) {
  if (c.photos) return <PhotoStrip c={c} side={side} />;
  const parts = side === "before" ? c.beforeParts : c.afterParts;
  if (parts) {
    return (
      <span className="admin-audit-diff__val">
        {parts.map((p, i) => (
          <span key={i}>
            <span className={`admin-audit-diff__tok admin-audit-diff__tok--${p.kind}`}>
              {p.text}
            </span>
            {i < parts.length - 1 ? " " : ""}
          </span>
        ))}
      </span>
    );
  }
  const raw = side === "before" ? c.before : c.after;
  return (
    <span className="admin-audit-diff__val">
      {raw || <span className="admin-audit-muted">(removed)</span>}
    </span>
  );
}

/** Thumbnail strip for a Photos change: N tiles, the changed positions get a
 *  colored ring + a round +/− badge (red for removed on the Before side,
 *  green for added on the After side). */
function PhotoStrip({ c, side }: { c: AuditFieldChange; side: "before" | "after" }) {
  const id = c.photos!;
  const count = side === "before" ? id.beforeCount : id.afterCount;
  const marked = side === "before" ? id.removedIdx : id.addedIdx;
  const images = side === "before" ? id.before : id.after;
  const sign = side === "before" ? "−" : "+";
  // Created rows have no previous state — the Before cell shows "—" exactly
  // like the created rows on the other tabs.
  if (count === 0) return <span className="admin-audit-diff__val">—</span>;
  return (
    <span className="admin-audit-diff__photos">
      {Array.from({ length: count }, (_, i) => i + 1).map((n) => (
        <span
          key={n}
          className={`admin-audit-diff__photo${marked.includes(n) ? ` admin-audit-diff__photo--${side === "before" ? "rm" : "add"}` : ""}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- local placeholder art */}
          <img src={images[n - 1]} alt={`Photo ${n}`} className="admin-audit-diff__photo-img" />
          {marked.includes(n) ? (
            <span className="admin-audit-diff__chip" aria-hidden="true">
              {sign}
            </span>
          ) : null}
        </span>
      ))}
    </span>
  );
}

/** Audit list screen (all state lives here; remounted by AuditLogPage). */
function AuditLogList() {
  const toast = useToastMessage();

  /* ---- list state ---- */
  const [logs, setLogs] = useState<AuditEntry[]>(() => [...INITIAL_AUDIT]);
  const [tab, setTab] = useState<EntityTab>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(""); // diterapkan hanya saat Search diklik / Enter ditekan
  const [range, setRange] = useState<AuditRange>("last7");
  const [userFilter, setUserFilter] = useState<string>("anyone");
  const [actionFilter, setActionFilter] = useState<AuditActionFilter>("any");
  const [reversibleOnly, setReversibleOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rawForId, setRawForId] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<"range" | "user" | "action" | null>(null);

  const setMenuFor = (key: "range" | "user" | "action" | null) => setOpenMenu(key);

  /* ---- filter counts (full list, pre-filter — tab badges like other pages) ---- */
  const counts = useMemo(() => {
    const tally = { all: logs.length } as Record<EntityTab, number>;
    for (const key of TAB_DEFS.slice(1).map((t) => t.key)) tally[key] = 0;
    for (const e of logs) tally[e.entity] += 1;
    return tally;
  }, [logs]);

  /* ---- derived rows: tab → reversible-only → user → action → range → search ---- */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((e) => {
      if (tab !== "all" && e.entity !== tab) return false;
      if (reversibleOnly && !(e.revertible && !e.reverted)) return false;
      if (userFilter !== "anyone" && e.actor.name !== userFilter) return false;
      if (actionFilter !== "any" && e.action !== actionFilter) return false;
      const since =
        range === "last7"
          ? AUDIT_NOW - 7 * 86_400_000
          : range === "last14"
            ? AUDIT_NOW - 14 * 86_400_000
            : range === "last30"
              ? AUDIT_NOW - 30 * 86_400_000
              : 0;
      if (since && new Date(e.occurredAt).getTime() < since) return false;
      if (q) {
        const hay = [
          e.title,
          e.actor.name,
          e.actor.email,
          e.resourceId,
          AUDIT_ENTITY_LABELS[e.entity],
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [logs, tab, reversibleOnly, userFilter, actionFilter, range, query]);

  /* ---- header sort: click toggles asc → desc (first click on a new column = asc) ---- */
  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  };

  /* String value for the active sort key (dates sort correctly in ISO form). */
  const sortValue = (e: AuditEntry, key: SortKey): string => {
    switch (key) {
      case "date":
        return e.occurredAt;
      case "user":
        return e.actor.name.toLowerCase();
      case "action":
        return e.title.toLowerCase();
    }
  };

  // Default order is newest first (matches the design's read-only state); a
  // chosen sort column overrides it, asc first, toggling to desc on re-click.
  const sorted = useMemo(() => {
    if (!sortKey) {
      return [...filtered].sort(
        (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
      );
    }
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);
  const shownStart = sorted.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const shownEnd = Math.min(safePage * pageSize, sorted.length);

  const activeFilterCount =
    (range !== "last7" ? 1 : 0) +
    (userFilter !== "anyone" ? 1 : 0) +
    (actionFilter !== "any" ? 1 : 0) +
    (reversibleOnly ? 1 : 0);

  /* ---- pagination: sliding window of 5 consecutive page numbers ---- */
  const pageNumbers: number[] = [];
  const winStart = Math.max(1, Math.min(safePage - 2, totalPages - 4));
  const winEnd = Math.min(totalPages, winStart + 4);
  for (let i = winStart; i <= winEnd; i++) pageNumbers.push(i);

  const switchTab = (next: EntityTab) => {
    setTab(next);
    setPage(1);
    setExpandedId(null);
  };

  const clearFilters = () => {
    setRange("last7");
    setUserFilter("anyone");
    setActionFilter("any");
    setReversibleOnly(false);
    setQuery("");
    setSearch("");
    setPage(1);
    setMenuFor(null);
  };

  /* ---- actions ---- */
  const revertLog = (entry: AuditEntry) => {
    setLogs((prev) =>
      prev.map((e) =>
        e.id === entry.id ? { ...e, reverted: true, revertible: false, action: "reverted" } : e,
      ),
    );
    toast.show(`Restored “${entry.title}”`);
  };

  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [
      ["Date", "User", "Email", "Action", "Entity", "Title", "ID"],
      ...sorted.map((e) => [
        esc(formatAuditDate(e.occurredAt)),
        esc(e.actor.name),
        esc(e.actor.email),
        e.action,
        AUDIT_ENTITY_LABELS[e.entity],
        esc(e.title),
        esc(e.resourceId),
      ]),
    ];
    const csv = "﻿" + rows.map((r) => r.join(",")).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.show(`Exported ${sorted.length} audit entries`);
  };

  /* ---- cells ---- */
  const actionLabel = (e: AuditEntry) => e.action.charAt(0).toUpperCase() + e.action.slice(1);

  const retentionCell = (e: AuditEntry) => {
    if (e.reverted) return <span className="admin-audit-muted">Reverted</span>;
    if (e.revertible && e.expiresAt)
      return (
        <div className="admin-audit-retention">
          <span className="admin-audit-window">{daysLeft(e.expiresAt)} days left</span>
          <Button
            variant="primary"
            size="sm"
            icon="refresh"
            className="admin-audit-revert"
            onClick={() => revertLog(e)}
          >
            Revert
          </Button>
        </div>
      );
    return <span className="admin-audit-muted">Not reversible</span>;
  };

  const diffPanel = (e: AuditEntry) => {
    // Every change in an entry shares the same snapshot moment, so the Before
    // and After clocks live in the column headers — "Before • 17 Oct 2026, 10:00"
    // — instead of repeating under each value. A created row has no prior state,
    // so its Before header carries no clock.
    const beforeAt = e.changes.find((c) => c.beforeAt)?.beforeAt ?? null;
    const afterAt = e.changes.find((c) => c.afterAt)?.afterAt ?? null;
    return (
      <div className="admin-audit-diff">
        <div className="admin-audit-diff__head" role="row">
          <span className="admin-audit-diff__field">Field</span>
          <span className="admin-audit-diff__col">
            <span>Before</span>
            {beforeAt ? (
              <span className="admin-audit-diff__head-clock">
                <span className="admin-audit-diff__dot" aria-hidden="true" />
                <span className="admin-audit-diff__stamp">{formatAuditDate(beforeAt)}</span>
              </span>
            ) : null}
          </span>
          <span className="admin-audit-diff__col">
            <span>After</span>
            {afterAt ? (
              <span className="admin-audit-diff__head-clock">
                <span className="admin-audit-diff__dot" aria-hidden="true" />
                <span className="admin-audit-diff__stamp">{formatAuditDate(afterAt)}</span>
              </span>
            ) : null}
          </span>
        </div>
        {e.changes.map((c) => (
          <div className="admin-audit-diff__row" role="row" key={c.field}>
            <span className="admin-audit-diff__field">
              {c.field}
              {c.photos && (c.photos.addedIdx.length > 0 || c.photos.removedIdx.length > 0) ? (
                <span className="admin-audit-diff__delta">
                  +{c.photos.addedIdx.length} −{c.photos.removedIdx.length}
                </span>
              ) : null}
            </span>
            <DiffSide c={c} side="before" />
            <DiffSide c={c} side="after" />
          </div>
        ))}
        <div className="admin-audit-diff__foot">
          <span className="admin-audit-diff__foot-left">
            <span className="admin-audit-diff__label">Change ID</span>
            <span className="admin-audit-diff__id">{e.changeId}</span>
            <button
              type="button"
              className="admin-audit-diff__copy"
              aria-label="Copy change id"
              onClick={() => {
                void navigator.clipboard?.writeText(e.changeId);
                toast.show("Change ID copied");
              }}
            >
              <Icon name="copy" size={12} />
            </button>
          </span>
          <button
            type="button"
            className={`admin-audit-diff__raw${rawForId === e.id ? " admin-audit-diff__raw--open" : ""}`}
            aria-expanded={rawForId === e.id}
            onClick={() => setRawForId(rawForId === e.id ? null : e.id)}
          >
            <Icon name="brackets" size={12} />
            Raw JSON
          </button>
        </div>
        {rawForId === e.id ? (
          <pre className="admin-audit-diff__json">{JSON.stringify(e, null, 2)}</pre>
        ) : null}
      </div>
    );
  };

  const columns: Column<AuditEntry>[] = [
    {
      key: "expand",
      header: null,
      width: "60px",
      render: (r: AuditEntry) => (
        <button
          type="button"
          className={`admin-audit-expand${expandedId === r.id ? " admin-audit-expand--on" : ""}`}
          aria-label="Show changes"
          aria-expanded={expandedId === r.id}
          onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
        >
          <Icon name={expandedId === r.id ? "chevronDown" : "chevronRight"} size={16} />
        </button>
      ),
    },
    {
      key: "date",
      header: (
        <SortHeader
          label="Date & Time"
          active={sortKey === "date"}
          dir={sortDir}
          onClick={() => onSort("date")}
        />
      ),
      width: "200px",
      render: (r: AuditEntry) => (
        <div className="admin-audit-date">
          <span className="admin-table__title">{formatAuditDate(r.occurredAt)}</span>
          <span className="admin-table__sub">{timeAgo(r.occurredAt)}</span>
        </div>
      ),
    },
    {
      key: "user",
      header: (
        <SortHeader
          label="User"
          active={sortKey === "user"}
          dir={sortDir}
          onClick={() => onSort("user")}
        />
      ),
      width: "400px",
      render: (r: AuditEntry) => (
        <div className="admin-audit-user">
          <span className="admin-audit-avatar">{r.actor.initials}</span>
          <span className="admin-audit-user__stack">
            <span className="admin-table__title">{r.actor.name}</span>
            <span className="admin-table__sub">{r.actor.email}</span>
          </span>
        </div>
      ),
    },
    {
      key: "action",
      header: (
        <SortHeader
          label="Action"
          active={sortKey === "action"}
          dir={sortDir}
          onClick={() => onSort("action")}
        />
      ),
      width: "500px",
      render: (r: AuditEntry) => (
        <div className="admin-audit-action">
          <span className="admin-audit-action__row">
            <span className={`admin-audit-badge admin-audit-badge--${r.action}`}>
              {actionLabel(r)}
            </span>
            <span className="admin-audit-entity">{AUDIT_ENTITY_LABELS[r.entity]}</span>
          </span>
          <span className="admin-table__title">{r.title}</span>
        </div>
      ),
    },
    {
      key: "code",
      header: null,
      width: "170px",
      render: (r: AuditEntry) => <span className="admin-audit-code">{r.resourceId}</span>,
    },
    {
      key: "revert",
      header: null,
      // The whole reversible block (days left + Revert button) sits flush
      // against the card's right edge, mirroring the Figma scannability.
      align: "right",
      width: "432px",
      render: retentionCell,
    },
  ];

  return (
    <>
      <div className="admin-page-header admin-audit-header">
        <div>
          <h1 className="admin-page-header__title">Audit Log</h1>
          <p className="admin-page-header__desc">
            Tracks admin actions and reversible operations for 14 days
          </p>
        </div>
        <div className="admin-page-header__actions">
          {/* Pill filters + export + search. */}
          <Button variant="outline" size="sm" icon="download" onClick={exportCsv}>
            Export CSV
          </Button>

          <span className="admin-audit-filter">
            <AuditPill
              label=""
              value={AUDIT_RANGE_OPTIONS.find((o) => o.key === range)!.label}
              icon="calendar"
              open={openMenu === "range"}
              onToggle={() => setMenuFor(openMenu === "range" ? null : "range")}
            />
            {openMenu === "range" ? (
              <AuditMenu
                options={AUDIT_RANGE_OPTIONS.map((o) => ({ key: o.key, label: o.label }))}
                selected={range}
                onSelect={(k) => {
                  setRange(k as AuditRange);
                  setPage(1);
                  setMenuFor(null);
                }}
                onClose={() => setMenuFor(null)}
              />
            ) : null}
          </span>

          <span className="admin-audit-filter">
            <AuditPill
              label="User"
              value={USER_OPTIONS.find((o) => o.key === userFilter)!.label}
              open={openMenu === "user"}
              onToggle={() => setMenuFor(openMenu === "user" ? null : "user")}
            />
            {openMenu === "user" ? (
              <AuditMenu
                options={USER_OPTIONS.map((o) => ({ key: o.key, label: o.label }))}
                selected={userFilter}
                onSelect={(k) => {
                  setUserFilter(k);
                  setPage(1);
                  setMenuFor(null);
                }}
                onClose={() => setMenuFor(null)}
              />
            ) : null}
          </span>

          <span className="admin-audit-filter">
            <AuditPill
              label="Action"
              value={AUDIT_ACTION_OPTIONS.find((o) => o.key === actionFilter)!.label}
              open={openMenu === "action"}
              onToggle={() => setMenuFor(openMenu === "action" ? null : "action")}
            />
            {openMenu === "action" ? (
              <AuditMenu
                options={AUDIT_ACTION_OPTIONS.map((o) => ({ key: o.key, label: o.label }))}
                selected={actionFilter}
                onSelect={(k) => {
                  setActionFilter(k as AuditActionFilter);
                  setPage(1);
                  setMenuFor(null);
                }}
                onClose={() => setMenuFor(null)}
              />
            ) : null}
          </span>

          {/* Search bar. */}
          <form
            className="admin-searchbox"
            onSubmit={(e) => {
              e.preventDefault();
              setQuery(search);
              setPage(1);
            }}
          >
            <Icon name="search" size={16} className="admin-searchbox__icon" />
            <input
              className="admin-searchbox__input"
              type="search"
              placeholder="Search"
              aria-label="Search audit entries"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (e.target.value === "") {
                  setQuery("");
                  setPage(1);
                }
              }}
            />
            <button type="submit" className="admin-searchbox__submit">
              Search
            </button>
          </form>
        </div>
      </div>

      <Card className="admin-card admin-list-card admin-audit-card">
        <CardBody flush>
          {/* Tabs + "Reversible only" toggle on one row. */}
          <div className="admin-audit-tabsrow">
            <div className="admin-tabs" role="tablist" aria-label="Audit entries">
              {TAB_DEFS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  className={`admin-tabs__btn${tab === key ? " admin-tabs__btn--active" : ""}`}
                  onClick={() => switchTab(key)}
                >
                  {label}
                  <span className="admin-tabs__count">{counts[key]}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={reversibleOnly}
              className={`admin-audit-toggle${reversibleOnly ? " admin-audit-toggle--on" : ""}`}
              onClick={() => {
                setReversibleOnly((v) => !v);
                setPage(1);
              }}
            >
              <span className="admin-audit-toggle__track" aria-hidden="true" />
              Reversible only
            </button>
          </div>

          {/* Table — expanded rows render the structured-diff panel. */}
          <DataTable
            columns={columns}
            rows={pageRows}
            rowKey={(r) => r.id}
            emptyText="No audit entries"
            minRows={pageSize}
            expandedRow={(r) => (expandedId === r.id ? diffPanel(r) : null)}
            emptyState={
              <div className="admin-empty admin-empty--stack">
                <span className="admin-empty__heading">
                  <Icon name="audit" size={16} />
                  <span className="admin-empty__title">
                    {query.trim()
                      ? `No audit entries match “${query.trim()}”`
                      : "No audit entries match your filters"}
                  </span>
                </span>
                <span className="admin-empty__hint">
                  {activeFilterCount > 0
                    ? `${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} are on. Try a new search or clear them.`
                    : "Try a new search or clear them."}
                </span>
                <span className="admin-empty__actions">
                  {query.trim() || activeFilterCount > 0 ? (
                    <Button variant="outline" size="sm" icon="x" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  ) : null}
                </span>
              </div>
            }
          />

          {/* Pagination footer. */}
          <div className="admin-darkbar">
            <span className="admin-darkbar__info">
              Showing {shownStart}–{shownEnd} of {sorted.length}
            </span>
            <span className="admin-darkbar__info">
              Rows per page
              <select
                className="admin-darkbar__select"
                aria-label="Rows per page"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                }}
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </span>
            <span className="admin-darkbar__spacer" />
            <button
              type="button"
              className="admin-darkbar__btn"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
              aria-label="Previous page"
            >
              <Icon name="chevronLeft" size={14} />
            </button>
            {pageNumbers.map((p) => (
              <button
                type="button"
                key={p}
                className={`admin-darkbar__btn${p === safePage ? " admin-darkbar__btn--active" : ""}`}
                onClick={() => setPage(p)}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              className="admin-darkbar__btn"
              disabled={safePage >= totalPages}
              onClick={() => setPage(safePage + 1)}
              aria-label="Next page"
            >
              <Icon name="chevronRight" size={14} />
            </button>
          </div>
        </CardBody>
      </Card>

      <ToastBanner message={toast.message} />
    </>
  );
}

/** Cream pill trigger for one of the header filters (range / user / action). */
function AuditPill({
  label,
  value,
  icon,
  open,
  onToggle,
}: {
  label: string;
  value: string;
  icon?: "calendar";
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`admin-audit-pill${open ? " admin-audit-pill--open" : ""}`}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={onToggle}
    >
      {icon ? <Icon name={icon} size={15} className="admin-audit-pill__icon" /> : null}
      {label ? <span className="admin-audit-pill__label">{label}</span> : null}
      <span className="admin-audit-pill__value">{value}</span>
      <Icon name="chevronDown" size={14} className="admin-audit-pill__chev" />
    </button>
  );
}

/** Popover menu under one of the audit pills. */
function AuditMenu({
  options,
  selected,
  onSelect,
  onClose,
}: {
  options: ReadonlyArray<{ key: string; label: string }>;
  selected: string;
  onSelect: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="admin-audit-menu__backdrop" onClick={onClose} />
      <div className="admin-audit-menu" role="menu">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="menuitemradio"
            aria-checked={o.key === selected}
            className={`admin-audit-menu__item${o.key === selected ? " admin-audit-menu__item--selected" : ""}`}
            onClick={() => onSelect(o.key)}
          >
            {o.label}
            {o.key === selected ? <Icon name="check" size={14} /> : null}
          </button>
        ))}
      </div>
    </>
  );
}
