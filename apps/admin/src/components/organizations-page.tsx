"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  activatePeriodAction,
  savePeriodAction,
  setChapterActiveAction,
} from "@/app/(panel)/organizations/actions";
import { actionMessage } from "@/components/action-message";
import { ChapterForm } from "@/components/chapter-form";
import { Card, CardBody } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FieldError } from "@/components/ui/field-error";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import type { ChapterItem } from "./chapters-model";
import type { PeriodItem } from "./periods-model";

/* ==================================================================
   Organizations — Period list and the PPI chapters list. Ported from
   the Figma "ORGANIZATIONS ADMIN" screens; colours come from the shared
   design tokens. A period's structure is its own page
   (/organizations/periods/[id], org-structure-page.tsx).
   ================================================================== */

/** Page subtitle on every screen (the Figma's own caption is a copy-paste
    leftover from the Gallery artboard, so the section name is corrected here). */
const ORG_SUBTITLE = "PPIDK ASIANIA ORGANIZATION ADMIN PAGE";

/** Screen state machine, following the breadcrumbs "Organizations > …". */
type OrgView = "period" | "ppi";

/** Rows-per-page options for the dark bar. */
const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

/** Create/Edit Period popup. */
type PeriodModalState = { mode: "create" } | { mode: "edit"; item: PeriodItem } | null;

/** Sortable table header — label + arrow icon, gold when sorting (same
    pattern as the Events table's sortable columns). */
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

/** Columns of the Period table that can be sorted (Aksi never sorts). */
type PeriodSortKey = "name" | "cabinet" | "status";

/** Columns of the PPI table that can be sorted. */
type PpiSortKey = "name" | "country";

/** Period status chip — a plain text pill without any icon (the Figma Period row shows just
    the badge, no logo). Only the active period is highlighted. */
function periodStatusBadge(status: PeriodItem["status"]): ReactNode {
  return (
    <span
      className={
        status === "active"
          ? "admin-org-status admin-org-status--active"
          : "admin-org-status admin-org-status--inactive"
      }
    >
      {status === "active" ? "Active" : status === "draft" ? "Draft" : "Archived"}
    </span>
  );
}

interface OrganizationsProps {
  /** PPI chapters from Firestore. */
  chapters: ChapterItem[];
  /** organizations.edit: add, edit, activate/deactivate chapters. */
  canEdit: boolean;
  /** Board periods from Firestore; null without periods.read (the Period tab is hidden). */
  periods: PeriodItem[] | null;
  /** periods.edit: add, edit and activate periods. */
  canEditPeriods: boolean;
}

export function OrganizationsPage(props: OrganizationsProps) {
  const pathname = usePathname();
  // key={pathname} remounts the list when the organizations route is (re)entered,
  // so pagination / selection / tab state start fresh on every visit (same
  // pattern as Events, Articles & Gallery).
  return <OrganizationsList key={pathname} {...props} />;
}

/** Organizations screens (all state lives here; remounted by OrganizationsPage
 *  on navigation so each visit starts clean). */
function OrganizationsList({
  chapters: ppis,
  canEdit,
  periods: periodList,
  canEditPeriods,
}: OrganizationsProps) {
  const periods = useMemo(() => periodList ?? [], [periodList]);
  const toast = useToastMessage();
  const router = useRouter();
  /* Chapter add/edit popup: null = closed, "new" = add, otherwise the chapter. */
  const [chapterForm, setChapterForm] = useState<ChapterItem | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  /* ---- navigation ---- */
  const [view, setView] = useState<OrgView>(periodList ? "period" : "ppi");
  /* ---- UI state ---- */
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [periodModal, setPeriodModal] = useState<PeriodModalState>(null);
  const [periodErrors, setPeriodErrors] = useState<Readonly<Record<string, string>>>({});
  /* Period waiting for the "Set as Active" confirmation. */
  const [activating, setActivating] = useState<PeriodItem | null>(null);
  const [periodPage, setPeriodPage] = useState(1);
  /* No sort applied on load — headers show the plain sort icon like the other
     pages; first click on a column turns ascending. */
  const [periodSort, setPeriodSort] = useState<PeriodSortKey | null>(null);
  const [periodSortDir, setPeriodSortDir] = useState<"asc" | "desc">("asc");
  const onPeriodSort = (key: PeriodSortKey) => {
    if (periodSort === key) {
      setPeriodSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setPeriodSort(key);
      setPeriodSortDir("asc");
    }
    setPeriodPage(1);
  };
  /* PPI table: name / country / members sort (same no-default-active pattern). */
  const [ppiSort, setPpiSort] = useState<PpiSortKey | null>(null);
  const [ppiSortDir, setPpiSortDir] = useState<"asc" | "desc">("asc");
  const onPpiSort = (key: PpiSortKey) => {
    if (ppiSort === key) {
      setPpiSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setPpiSort(key);
      setPpiSortDir("asc");
    }
    setPpiPage(1);
  };
  const [ppiPage, setPpiPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  /* ---- period list: header sort + pagination ---- */
  const sortedPeriods = useMemo(() => {
    if (!periodSort) return periods;
    const copy = [...periods];
    copy.sort((a, b) => {
      const av = periodSort === "name" ? a.name : periodSort === "cabinet" ? a.cabinet : a.status;
      const bv = periodSort === "name" ? b.name : periodSort === "cabinet" ? b.cabinet : b.status;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return periodSortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [periods, periodSort, periodSortDir]);
  const periodTotalPages = Math.max(1, Math.ceil(periods.length / pageSize));
  const periodSafePage = Math.min(periodPage, periodTotalPages);
  const periodPageRows = sortedPeriods.slice(
    (periodSafePage - 1) * pageSize,
    periodSafePage * pageSize,
  );
  const periodShownStart = periods.length === 0 ? 0 : (periodSafePage - 1) * pageSize + 1;
  const periodShownEnd = Math.min(periodSafePage * pageSize, periods.length);

  /* ---- ppi list: sort + pagination (full list — All/Upcoming tabs are gone) ---- */
  const sortedPpis = useMemo(() => {
    if (!ppiSort) return ppis;
    const copy = [...ppis];
    copy.sort((a, b) => {
      const av = ppiSort === "name" ? a.name : a.country;
      const bv = ppiSort === "name" ? b.name : b.country;
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    return ppiSortDir === "asc" ? copy : copy.reverse();
  }, [ppis, ppiSort, ppiSortDir]);
  const ppiTotalPages = Math.max(1, Math.ceil(sortedPpis.length / pageSize));
  const ppiSafePage = Math.min(ppiPage, ppiTotalPages);
  const ppiPageRows = sortedPpis.slice((ppiSafePage - 1) * pageSize, ppiSafePage * pageSize);
  const ppiShownStart = sortedPpis.length === 0 ? 0 : (ppiSafePage - 1) * pageSize + 1;
  const ppiShownEnd = Math.min(ppiSafePage * pageSize, sortedPpis.length);

  /* ---- bulk selection (PPI table) ---- */
  const pageSelected = ppiPageRows.every((r) => selected.has(r.id));
  const pageSomeSelected = ppiPageRows.some((r) => selected.has(r.id));
  const toggleAllPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageSelected) ppiPageRows.forEach((r) => next.delete(r.id));
      else ppiPageRows.forEach((r) => next.add(r.id));
      return next;
    });
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  /* ---- actions ---- */
  const exportPeriodsCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [
      ["Period", "Cabinet", "Start", "End", "Status"],
      ...periods.map((p) => [esc(p.name), esc(p.cabinet), p.startsOn, p.endsOn, p.status]),
    ];
    const csv = "﻿" + rows.map((r) => r.join(",")).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `periods-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.show(`Exported ${periods.length} periods`);
  };

  const exportPpisCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const rows = [
      ["Chapter", "Country", "Timezone", "Status", "Contact person", "Public contact"],
      ...ppis.map((p) => [
        esc(p.name),
        esc(p.country),
        esc(p.timezone),
        p.active ? "Active" : "Inactive",
        esc(p.contactName),
        esc(p.contactPublic),
      ]),
    ];
    const csv = "﻿" + rows.map((r) => r.join(",")).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `ppi-chapters-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.show(`Exported ${ppis.length} chapters`);
  };

  /* ---- period actions (Firestore; archived periods are read-only, never deleted) ---- */
  const activatePeriod = async (period: PeriodItem) => {
    setBusy(true);
    const result = await activatePeriodAction({ id: period.id, version: period.version });
    setBusy(false);
    setActivating(null);
    if (!result.ok) return toast.show(actionMessage(result));
    router.refresh();
    toast.show(`Period ${period.name} is now active`);
  };

  /* ---- period modal ---- */
  const savePeriod = async () => {
    if (!periodModal) return;
    const value = (id: string) =>
      document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#org-period-${id}`)?.value ??
      "";
    setBusy(true);
    const result = await savePeriodAction({
      ...(periodModal.mode === "edit"
        ? { id: periodModal.item.id, version: periodModal.item.version }
        : { version: null }),
      name: value("name"),
      cabinet: value("cabinet"),
      startsOn: value("startsOn"),
      endsOn: value("endsOn"),
      vision: value("vision"),
      mission: value("mission"),
      lpjDeadlineDays: Number(value("lpjDeadlineDays")),
    });
    setBusy(false);
    if (!result.ok) {
      setPeriodErrors(result.fields ?? {});
      return toast.show(actionMessage(result));
    }
    setPeriodModal(null);
    setPeriodErrors({});
    router.refresh();
    toast.show(periodModal.mode === "edit" ? "Period saved" : "Period created");
  };

  /* ---- shared pagination bar ---- */
  const pageNumbers: number[] = [];
  {
    const total = view === "period" ? periodTotalPages : ppiTotalPages;
    const safe = view === "period" ? periodSafePage : ppiSafePage;
    const winStart = Math.max(1, Math.min(safe - 2, total - 4));
    const winEnd = Math.min(total, winStart + 4);
    for (let i = winStart; i <= winEnd; i++) pageNumbers.push(i);
  }

  /** Current page of whichever list is on screen (Period / PPI). */
  const safePage = view === "period" ? periodSafePage : ppiSafePage;
  const totalPages = view === "period" ? periodTotalPages : ppiTotalPages;
  const setPage = (p: number) => (view === "period" ? setPeriodPage(p) : setPpiPage(p));

  const paginationBar = (shownStart: number, shownEnd: number, total: number) => (
    <div className="admin-darkbar">
      <span className="admin-darkbar__info">
        Showing {shownStart}–{shownEnd} of {total}
      </span>
      <span className="admin-darkbar__info">
        Rows per page
        <select
          className="admin-darkbar__select"
          aria-label="Rows per page"
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
            setPeriodPage(1);
            setPpiPage(1);
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
          className={`admin-darkbar__btn${safePage === p ? " admin-darkbar__btn--active" : ""}`}
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
  );

  /* ================================================================
     SCREENS
     ================================================================ */

  if (view === "period") {
    const columns: Column<PeriodItem>[] = [
      {
        key: "name",
        header: (
          <SortHeader
            label="Period"
            active={periodSort === "name"}
            dir={periodSortDir}
            onClick={() => onPeriodSort("name")}
          />
        ),
        width: "40%",
        render: (r) => <span className="admin-table__title">{r.name}</span>,
      },
      {
        key: "cabinet",
        header: (
          <SortHeader
            label="Cabinet"
            active={periodSort === "cabinet"}
            dir={periodSortDir}
            onClick={() => onPeriodSort("cabinet")}
          />
        ),
        width: "34%",
        render: (r) => <span className="admin-table__title">{r.cabinet}</span>,
      },
      {
        key: "status",
        header: (
          <SortHeader
            label="Status"
            active={periodSort === "status"}
            dir={periodSortDir}
            onClick={() => onPeriodSort("status")}
          />
        ),
        width: "18%",
        render: (r) => periodStatusBadge(r.status),
      },
      {
        key: "aksi",
        header: "",
        align: "right",
        width: "12%",
        render: (r) => (
          <div className="admin-table__actions">
            {canEditPeriods && r.status !== "archived" ? (
              <Button
                variant="ghost"
                size="icon"
                icon="edit"
                aria-label="Edit"
                title="Edit"
                onClick={() => {
                  setMenuFor(null);
                  setPeriodErrors({});
                  setPeriodModal({ mode: "edit", item: r });
                }}
              />
            ) : null}
            <div className="admin-row-menu">
              {menuFor === `per-${r.id}` ? (
                <div className="admin-row-menu__backdrop" onClick={() => setMenuFor(null)} />
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                icon="more"
                aria-label="More actions"
                title="More actions"
                onClick={() => setMenuFor(menuFor === `per-${r.id}` ? null : `per-${r.id}`)}
              />
              {menuFor === `per-${r.id}` ? (
                <div className="admin-row-menu__panel" role="menu">
                  <button
                    type="button"
                    className="admin-row-menu__item"
                    role="menuitem"
                    onClick={() => router.push(`/organizations/periods/${r.id}`)}
                  >
                    <Icon name="settings" size={14} /> Manage Structure
                  </button>
                  {canEditPeriods && r.status === "draft" ? (
                    <button
                      type="button"
                      className="admin-row-menu__item"
                      role="menuitem"
                      onClick={() => {
                        setMenuFor(null);
                        setActivating(r);
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- packed public asset, same logo as the Public badge */}
                      <img
                        src="/globe.png"
                        alt=""
                        width={14}
                        height={14}
                        className="admin-status-badge__img"
                      />{" "}
                      Set as Active
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ),
      },
    ];

    return (
      <>
        <div className="admin-page-header admin-events-header">
          <div>
            <h1 className="admin-page-header__title">Organizations &gt; Period</h1>
            <p className="admin-page-header__desc">{ORG_SUBTITLE}</p>
          </div>
          <div className="admin-page-header__actions">
            <Button variant="outline" size="sm" icon="download" onClick={exportPeriodsCsv}>
              Export CSV
            </Button>
            {canEditPeriods ? (
              <Button
                variant="ghost"
                size="sm"
                icon="plus"
                className="admin-btn--events-add"
                onClick={() => {
                  setPeriodErrors({});
                  setPeriodModal({ mode: "create" });
                }}
              >
                Add New Period
              </Button>
            ) : null}
          </div>
        </div>

        <Card className="admin-events-card admin-list-card admin-org-card">
          <CardBody flush>
            {/* Section tabs: Period list vs PPI chapters (top-level switch). */}
            <div className="admin-tabs" role="tablist" aria-label="Organization lists">
              <button
                type="button"
                role="tab"
                aria-selected={view === "period"}
                className={`admin-tabs__btn${view === "period" ? " admin-tabs__btn--active" : ""}`}
                onClick={() => setView("period")}
              >
                Period
                <span className="admin-tabs__count">{periods.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={false}
                className="admin-tabs__btn"
                onClick={() => {
                  setView("ppi");
                  setMenuFor(null);
                }}
              >
                PPI
                <span className="admin-tabs__count">{ppis.length}</span>
              </button>
            </div>
            <DataTable
              columns={columns}
              rows={periodPageRows}
              rowKey={(r) => r.id}
              minRows={pageSize}
            />
            {paginationBar(periodShownStart, periodShownEnd, periods.length)}
          </CardBody>
        </Card>

        {/* Create/Edit Period popup, Cancel keeps the list. */}
        <Modal
          open={periodModal !== null}
          title={periodModal?.mode === "edit" ? "Edit Period" : "Create Period"}
          className="admin-modal--light"
          width={420}
          hideClose
          onClose={() => setPeriodModal(null)}
          footer={
            <div className="admin-modal__footer-row">
              <Button
                variant="ghost"
                className="admin-btn--light admin-modal__foot-btn"
                onClick={() => setPeriodModal(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className="admin-modal__foot-btn"
                icon="cloud"
                disabled={busy}
                onClick={() => void savePeriod()}
              >
                Save
              </Button>
            </div>
          }
        >
          {(
            [
              ["name", "Period *", "text", "e.g 2026/2027"],
              ["cabinet", "Cabinet", "text", "e.g Kolaborasi Asiania"],
              ["startsOn", "Start date *", "date", ""],
              ["endsOn", "End date *", "date", ""],
              ["lpjDeadlineDays", "LPJ due (days after the end) *", "number", "30"],
            ] as const
          ).map(([key, text, type, placeholder]) => (
            <div className="admin-field" key={key}>
              <label className="admin-field__label" htmlFor={`org-period-${key}`}>
                {text}
              </label>
              <input
                id={`org-period-${key}`}
                className="admin-input"
                type={type}
                placeholder={placeholder}
                defaultValue={
                  periodModal?.mode === "edit"
                    ? String(periodModal.item[key])
                    : key === "lpjDeadlineDays"
                      ? "30"
                      : ""
                }
                aria-invalid={periodErrors[key] ? true : undefined}
                aria-describedby={`org-period-${key}-error`}
              />
              <FieldError id={`org-period-${key}-error`} message={periodErrors[key]} />
            </div>
          ))}
          {(
            [
              ["vision", "Vision"],
              ["mission", "Mission"],
            ] as const
          ).map(([key, text]) => (
            <div className="admin-field" key={key}>
              <label className="admin-field__label" htmlFor={`org-period-${key}`}>
                {text}
              </label>
              <textarea
                id={`org-period-${key}`}
                className="admin-input"
                rows={3}
                defaultValue={periodModal?.mode === "edit" ? periodModal.item[key] : ""}
                aria-describedby={`org-period-${key}-error`}
              />
              <FieldError id={`org-period-${key}-error`} message={periodErrors[key]} />
            </div>
          ))}
        </Modal>

        <ConfirmDialog
          open={activating !== null}
          title={`Make ${activating?.name ?? ""} the active period?`}
          confirmLabel="Set as Active"
          tone="primary"
          pending={busy}
          onCancel={() => setActivating(null)}
          onConfirm={() => activating && void activatePeriod(activating)}
        >
          The current active period is archived and becomes read-only. Roles given for one period
          only count during that period.
        </ConfirmDialog>

        <ToastBanner message={toast.message} />
      </>
    );
  }

  /* ---- PPI chapters (Firestore; deactivate instead of delete) ---- */
  const ppiSelected = selected.size;
  const setActiveFor = async (rows: readonly ChapterItem[], active: boolean) => {
    setBusy(true);
    let count = 0;
    for (const r of rows) {
      const result = await setChapterActiveAction({ id: r.id, version: r.version, active });
      if (!result.ok) {
        toast.show(actionMessage(result));
        break;
      }
      count++;
    }
    setBusy(false);
    clearSelection();
    router.refresh();
    if (count > 0) {
      toast.show(
        `${count} chapter${count === 1 ? "" : "s"} ${active ? "activated" : "deactivated"}`,
      );
    }
  };
  const columns: Column<ChapterItem>[] = [
    {
      key: "check",
      width: "24px",
      align: "left",
      header: (
        <label className="admin-checkbox">
          <input
            type="checkbox"
            aria-label="Select all on page"
            checked={pageSelected}
            ref={(el) => {
              if (el) el.indeterminate = pageSomeSelected && !pageSelected;
            }}
            onChange={toggleAllPage}
            className="admin-table__checkbox"
          />
          <span aria-hidden="true" />
        </label>
      ),
      render: (r) => (
        <label className="admin-checkbox">
          <input
            type="checkbox"
            aria-label={`Select ${r.name}`}
            checked={selected.has(r.id)}
            onChange={() => toggleOne(r.id)}
            className="admin-table__checkbox"
          />
          <span aria-hidden="true" />
        </label>
      ),
    },
    {
      key: "name",
      header: (
        <SortHeader
          label="PPI"
          active={ppiSort === "name"}
          dir={ppiSortDir}
          onClick={() => onPpiSort("name")}
        />
      ),
      width: "22%",
      render: (r) => (
        <div>
          <div className="admin-table__title">{r.name}</div>
          <div className="admin-table__sub">#{r.countryCode}</div>
        </div>
      ),
    },
    {
      key: "country",
      header: (
        <SortHeader
          label="Country"
          active={ppiSort === "country"}
          dir={ppiSortDir}
          onClick={() => onPpiSort("country")}
        />
      ),
      width: "16%",
      render: (r) => <span className="admin-table__title">{r.country}</span>,
    },
    {
      key: "timezone",
      header: "Timezone",
      width: "16%",
      render: (r) => (
        <span className="admin-table__sub admin-org-timezone">
          <Icon name="clock" size={12} /> {r.timezone}
        </span>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      width: "20%",
      render: (r) => (
        <span className="admin-org-notes">
          {r.contactName}
          {r.contactPublic && ` · ${r.contactPublic}`}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "12%",
      render: (r) => (
        <div className="admin-org-badges">
          {r.active ? (
            <span className="admin-org-status">Active</span>
          ) : (
            <span className="admin-org-status admin-org-status--inactive">Inactive</span>
          )}
        </div>
      ),
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      width: "12%",
      render: (r) =>
        canEdit ? (
          <div className="admin-table__actions">
            <Button
              variant="ghost"
              size="icon"
              icon={r.active ? "lock" : "globe"}
              aria-label={r.active ? `Deactivate ${r.name}` : `Activate ${r.name}`}
              title={r.active ? "Deactivate (hidden from the map)" : "Activate"}
              disabled={busy}
              onClick={() => void setActiveFor([r], !r.active)}
            />
            <Button
              variant="ghost"
              size="icon"
              icon="edit"
              aria-label="Edit"
              title="Edit"
              onClick={() => setChapterForm(r)}
            />
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">Organizations &gt; PPI</h1>
          <p className="admin-page-header__desc">{ORG_SUBTITLE}</p>
        </div>
        <div className="admin-page-header__actions">
          <Button variant="outline" size="sm" icon="download" onClick={exportPpisCsv}>
            Export CSV
          </Button>
          {canEdit ? (
            <Button
              variant="ghost"
              size="sm"
              icon="plus"
              className="admin-btn--events-add"
              onClick={() => setChapterForm("new")}
            >
              Add New PPI
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="admin-events-card admin-list-card admin-org-card">
        <CardBody flush>
          {/* Section tabs: Period list vs PPI chapters (top-level switch). */}
          <div className="admin-tabs" role="tablist" aria-label="Organization lists">
            {periodList ? (
              <button
                type="button"
                role="tab"
                aria-selected={false}
                className="admin-tabs__btn"
                onClick={() => {
                  setView("period");
                  setMenuFor(null);
                }}
              >
                Period
                <span className="admin-tabs__count">{periods.length}</span>
              </button>
            ) : null}
            <button
              type="button"
              role="tab"
              aria-selected={view === "ppi"}
              className={`admin-tabs__btn${view === "ppi" ? " admin-tabs__btn--active" : ""}`}
              onClick={() => setView("ppi")}
            >
              PPI
              <span className="admin-tabs__count">{ppis.length}</span>
            </button>
          </div>

          <DataTable columns={columns} rows={ppiPageRows} rowKey={(r) => r.id} minRows={pageSize} />

          {ppiSelected > 0 ? (
            /* Bulk action bar — shown in place of the pagination bar while
               rows are selected (same treatment as the Events list). */
            <div className="admin-bulkbar">
              <span className="admin-bulkbar__summary">
                <label className="admin-checkbox">
                  <input
                    type="checkbox"
                    aria-label="Select all on page"
                    checked={pageSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = pageSomeSelected && !pageSelected;
                    }}
                    onChange={toggleAllPage}
                    className="admin-table__checkbox"
                  />
                  <span aria-hidden="true" />
                </label>
                {ppiSelected} selected
              </span>
              <div className="admin-bulkbar__actions">
                {canEdit ? (
                  <Button
                    variant="danger"
                    size="sm"
                    icon="lock"
                    disabled={busy}
                    onClick={() =>
                      void setActiveFor(
                        ppis.filter((p) => selected.has(p.id) && p.active),
                        false,
                      )
                    }
                  >
                    Deactivate
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            paginationBar(ppiShownStart, ppiShownEnd, ppis.length)
          )}
        </CardBody>
      </Card>

      {chapterForm !== null ? (
        <ChapterForm
          chapter={chapterForm === "new" ? null : chapterForm}
          onClose={() => setChapterForm(null)}
          onSaved={(text) => {
            setChapterForm(null);
            router.refresh();
            toast.show(text);
          }}
        />
      ) : null}

      <ToastBanner message={toast.message} />
    </>
  );
}
