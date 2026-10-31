"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  activatePeriodAction,
  deleteChapterAction,
  deletePeriodAction,
  savePeriodAction,
} from "@/app/(panel)/organizations/actions";
import { actionMessage } from "@/components/action-message";
import { downloadCsv } from "@/components/csv";
import { esc } from "@/components/format";
import { ChapterForm } from "@/components/chapter-form";
import { Card, CardBody } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FieldError } from "@/components/ui/field-error";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Icon } from "@/components/ui/icon";
import { Modal } from "@/components/ui/modal";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { CHAPTER_RISK_LABELS, label } from "@/labels";
import type { ChapterItem } from "./chapters-model";
import type { PeriodItem } from "./periods-model";
import { Select } from "@/components/ui/select";

/* ==================================================================
   Organizations — Period list and the PPI chapters list, ported from
   the Figma "ORGANIZATIONS ADMIN" screens. A period's structure is its
   own page (/organizations/periods/[id], org-structure-page.tsx).
   ================================================================== */

/** Page subtitle on every Organizations screen (the Figma's "GALLERY" caption is a copy-paste
    leftover from the Gallery artboard, so the section name is corrected here). */
export const ORG_SUBTITLE =
  "Manage the board periods, their structure and the PPI chapters shown on the public site.";

/** The two lists of the Organizations page (`?view=ppi` opens the PPI list). */
export type OrgView = "period" | "ppi";

/** Rows-per-page options for the dark bar. */
const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

/** Create/Edit Period popup. */
type PeriodModalState = { mode: "create" } | { mode: "edit"; item: PeriodItem } | null;

/** What waits for the delete confirmation. */
type DeleteState =
  { kind: "period"; item: PeriodItem } | { kind: "ppis"; items: ChapterItem[] } | null;

/** Period / PPI tabs under the page title. On the Structure page they are links back. */
export function OrgTabs({
  view,
  onSelect,
  showPeriod = true,
}: {
  view: OrgView;
  /** Switch in place; without it the tabs link to /organizations. */
  onSelect?: (view: OrgView) => void;
  showPeriod?: boolean;
}) {
  const router = useRouter();
  const tabs: [OrgView, string][] = showPeriod
    ? [
        ["period", "Period"],
        ["ppi", "PPI"],
      ]
    : [["ppi", "PPI"]];
  return (
    <div className="admin-tabs" role="tablist" aria-label="Organization lists">
      {tabs.map(([key, text]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={view === key}
          className={`admin-tabs__btn${view === key ? " admin-tabs__btn--active" : ""}`}
          onClick={() =>
            onSelect
              ? onSelect(key)
              : router.push(key === "ppi" ? "/organizations?view=ppi" : "/organizations")
          }
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Dark delete confirmation (same as the Events page): "Delete N PPIS?", Back / Delete. */
export function OrgDeleteDialog({
  open,
  title,
  confirmLabel,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  confirmLabel: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      width={460}
      hideClose
      onClose={onCancel}
      footer={
        <div className="admin-modal__footer-row">
          <Button variant="outline" icon="chevronLeft" onClick={onCancel}>
            Back
          </Button>
          <Button variant="danger" icon="trash" disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="admin-delete-confirm__message">
        They disappear from the public page now. You can revert deletion on the admin log before 14
        days.
      </p>
    </Modal>
  );
}

/** Sortable table header — label + arrow icon (same pattern as the Events table). */
function SortHeader({
  label: text,
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
      <span>{text}</span>
      <Icon name={active ? (dir === "asc" ? "arrowUp" : "arrowDown") : "sort"} size={12} />
    </button>
  );
}

/** Columns of the Period table that can be sorted. */
type PeriodSortKey = "name" | "status";

/** Columns of the PPI table that can be sorted. */
type PpiSortKey = "name" | "country" | "memberCount";

/** Cream pill (Figma status chip). The design shows Active / Inactive only. */
const statusChip = (text: string) => <span className="admin-status-badge">{text}</span>;

interface OrganizationsProps {
  /** PPI chapters from the database. */
  chapters: ChapterItem[];
  /** organizations.edit: add, edit, activate/deactivate and delete chapters. */
  canEdit: boolean;
  /** Chapters whose contact details this chapter admin may edit (organizations.edit there). */
  contactEditIds: string[];
  /** Board periods from the database; null without periods.read (the Period tab is hidden). */
  periods: PeriodItem[] | null;
  /** periods.edit: add, edit, activate and delete periods. */
  canEditPeriods: boolean;
  /** List shown first (`?view=ppi`). */
  initialView: OrgView;
}

export function OrganizationsPage(props: OrganizationsProps) {
  const pathname = usePathname();
  // key={pathname} remounts the list when the organizations route is (re)entered,
  // so pagination / selection / tab state start fresh on every visit.
  return <OrganizationsList key={pathname} {...props} />;
}

/** Organizations screens (all state lives here; remounted on navigation). */
function OrganizationsList({
  chapters: ppis,
  canEdit,
  contactEditIds,
  periods: periodList,
  canEditPeriods,
  initialView,
}: OrganizationsProps) {
  const periods = useMemo(() => periodList ?? [], [periodList]);
  const toast = useToastMessage();
  const router = useRouter();
  /* Chapter add/edit popup: null = closed, "new" = add, otherwise the chapter. */
  const [chapterForm, setChapterForm] = useState<ChapterItem | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<OrgView>(periodList ? initialView : "ppi");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [periodModal, setPeriodModal] = useState<PeriodModalState>(null);
  const [periodErrors, setPeriodErrors] = useState<Readonly<Record<string, string>>>({});
  /* Period waiting for the "Set as Active" confirmation. */
  const [activating, setActivating] = useState<PeriodItem | null>(null);
  const [deleting, setDeleting] = useState<DeleteState>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  /* No sort applied on load; the first click on a column sorts ascending. */
  const [periodSort, setPeriodSort] = useState<PeriodSortKey | null>(null);
  const [ppiSort, setPpiSort] = useState<PpiSortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const sortBy = <K extends string>(current: K | null, key: K, set: (k: K) => void) => {
    if (current === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      set(key);
      setSortDir("asc");
    }
    setPage(1);
  };
  const switchView = (next: OrgView) => {
    setView(next);
    setMenuFor(null);
    setPage(1);
  };

  const sortedPeriods = useMemo(() => {
    if (!periodSort) return periods;
    return [...periods].sort((a, b) => {
      const cmp = a[periodSort] < b[periodSort] ? -1 : a[periodSort] > b[periodSort] ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [periods, periodSort, sortDir]);
  const sortedPpis = useMemo(() => {
    if (!ppiSort) return ppis;
    return [...ppis].sort((a, b) => {
      const cmp = a[ppiSort] < b[ppiSort] ? -1 : a[ppiSort] > b[ppiSort] ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [ppis, ppiSort, sortDir]);

  /* ---- pagination of whichever list is on screen ---- */
  const total = view === "period" ? periods.length : ppis.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const shownStart = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const shownEnd = Math.min(safePage * pageSize, total);
  const periodPageRows = sortedPeriods.slice((safePage - 1) * pageSize, safePage * pageSize);
  const ppiPageRows = sortedPpis.slice((safePage - 1) * pageSize, safePage * pageSize);
  const pageNumbers: number[] = [];
  {
    const winStart = Math.max(1, Math.min(safePage - 2, totalPages - 4));
    for (let i = winStart; i <= Math.min(totalPages, winStart + 4); i++) pageNumbers.push(i);
  }

  /* ---- bulk selection (PPI table) ---- */
  const pageSelected = ppiPageRows.length > 0 && ppiPageRows.every((r) => selected.has(r.id));
  const pageSomeSelected = ppiPageRows.some((r) => selected.has(r.id));
  const toggleAllPage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of ppiPageRows) {
        if (pageSelected) next.delete(r.id);
        else next.add(r.id);
      }
      return next;
    });
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /* ---- actions ---- */
  const exportPeriodsCsv = () => {
    downloadCsv("periods", [
      ["Period", "Cabinet", "Start", "End", "Status"],
      ...periods.map((p) => [esc(p.name), esc(p.cabinet), p.startsOn, p.endsOn, p.status]),
    ]);
    toast.show(`Exported ${periods.length} periods`);
  };
  const exportPpisCsv = () => {
    downloadCsv("ppi-chapters", [
      ["Chapter", "Country", "Timezone", "Members", "Conditions", "Risk", "Status"],
      ...ppis.map((p) => [
        esc(p.name),
        esc(p.country),
        esc(p.timezone),
        String(p.memberCount),
        esc(p.conditions.join(" · ")),
        label(CHAPTER_RISK_LABELS, p.risk),
        p.active ? "Active" : "Inactive",
      ]),
    ]);
    toast.show(`Exported ${ppis.length} chapters`);
  };

  const activatePeriod = async (period: PeriodItem) => {
    setBusy(true);
    const result = await activatePeriodAction({ id: period.id, version: period.version });
    setBusy(false);
    setActivating(null);
    if (!result.ok) return toast.show(actionMessage(result));
    router.refresh();
    toast.show(`Period ${period.name} is now active`);
  };

  const savePeriod = async () => {
    if (!periodModal) return;
    const value = (id: string) =>
      document.querySelector<HTMLInputElement>(`#org-period-${id}`)?.value ?? "";
    setBusy(true);
    const result = await savePeriodAction({
      ...(periodModal.mode === "edit"
        ? { id: periodModal.item.id, version: periodModal.item.version }
        : { version: null }),
      name: value("name"),
      cabinet: value("cabinet"),
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

  /** Deletes one period or the selected chapters (soft; revertible in the Audit Log). */
  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    let count = 0;
    let failure: string | null = null;
    const rows = deleting.kind === "period" ? [deleting.item] : deleting.items;
    for (const r of rows) {
      const remove = deleting.kind === "period" ? deletePeriodAction : deleteChapterAction;
      const result = await remove({ id: r.id, version: r.version });
      if (!result.ok) {
        failure = actionMessage(result);
        break;
      }
      count++;
    }
    setBusy(false);
    setDeleting(null);
    setSelected(new Set());
    router.refresh();
    if (failure) return toast.show(failure);
    toast.show(
      deleting.kind === "period"
        ? `Period ${deleting.item.name} deleted`
        : `${count} PPI${count === 1 ? "" : "s"} deleted`,
    );
  };

  const paginationBar = (
    <div className="admin-darkbar">
      <span className="admin-darkbar__info">
        Showing {shownStart}–{shownEnd} of {total}
      </span>
      <span className="admin-darkbar__info">
        Rows per page
        <Select
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
        </Select>
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

  const header = (title: string, actions: ReactNode) => (
    <>
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">{title}</h1>
          <p className="admin-page-header__desc">{ORG_SUBTITLE}</p>
        </div>
        <div className="admin-page-header__actions">{actions}</div>
      </div>
      <OrgTabs view={view} onSelect={switchView} showPeriod={periodList !== null} />
    </>
  );

  const deleteDialog = (
    <OrgDeleteDialog
      open={deleting !== null}
      title={
        deleting?.kind === "ppis"
          ? `Delete ${deleting.items.length} PPI${deleting.items.length === 1 ? "" : "S"}?`
          : `Delete Period ${deleting?.item.name ?? ""}?`
      }
      confirmLabel={
        deleting?.kind === "ppis"
          ? `Delete ${deleting.items.length} PPI${deleting.items.length === 1 ? "" : "S"}`
          : "Delete Period"
      }
      pending={busy}
      onCancel={() => setDeleting(null)}
      onConfirm={() => void confirmDelete()}
    />
  );

  /* ================================================================
     PERIOD LIST
     ================================================================ */

  if (view === "period") {
    const columns: Column<PeriodItem>[] = [
      {
        key: "name",
        header: (
          <SortHeader
            label="Period"
            active={periodSort === "name"}
            dir={sortDir}
            onClick={() => sortBy(periodSort, "name", setPeriodSort)}
          />
        ),
        width: "40%",
        render: (r) => <span className="admin-table__title">{r.name}</span>,
      },
      {
        key: "cabinet",
        header: "Cabinet",
        width: "40%",
        render: (r) => <span className="admin-table__title">{r.cabinet}</span>,
      },
      {
        key: "status",
        header: (
          <SortHeader
            label="Status"
            active={periodSort === "status"}
            dir={sortDir}
            onClick={() => sortBy(periodSort, "status", setPeriodSort)}
          />
        ),
        width: "12%",
        render: (r) => statusChip(r.status === "active" ? "Active" : "Inactive"),
      },
      {
        key: "aksi",
        header: "",
        align: "right",
        width: "8%",
        render: (r) => (
          <div className="admin-table__actions">
            {canEditPeriods && r.status !== "archived" ? (
              <Button
                variant="ghost"
                size="icon"
                icon="edit"
                aria-label={`Edit ${r.name}`}
                title="Edit"
                onClick={() => {
                  setMenuFor(null);
                  setPeriodErrors({});
                  setPeriodModal({ mode: "edit", item: r });
                }}
              />
            ) : null}
            <div className="admin-row-menu">
              {menuFor === r.id ? (
                <div className="admin-row-menu__backdrop" onClick={() => setMenuFor(null)} />
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                icon="more"
                aria-label="More actions"
                title="More actions"
                onClick={() => setMenuFor(menuFor === r.id ? null : r.id)}
              />
              {menuFor === r.id ? (
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
                      <Icon name="globe" size={14} /> Set as Active
                    </button>
                  ) : null}
                  {canEditPeriods && r.status !== "active" ? (
                    <div className="admin-row-menu__divider" role="separator" />
                  ) : null}
                  {canEditPeriods && r.status !== "active" ? (
                    <button
                      type="button"
                      className="admin-row-menu__item admin-row-menu__item--danger"
                      role="menuitem"
                      onClick={() => {
                        setMenuFor(null);
                        setDeleting({ kind: "period", item: r });
                      }}
                    >
                      <Icon name="trash" size={14} /> Delete Period
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
      <div>
        {header(
          "Organizations > Period",
          <>
            <Button variant="outline" size="sm" icon="download" onClick={exportPeriodsCsv}>
              Export CSV
            </Button>
            {canEditPeriods ? (
              <Button
                variant="outline"
                size="sm"
                icon="plus"
                onClick={() => {
                  setPeriodErrors({});
                  setPeriodModal({ mode: "create" });
                }}
              >
                Add New Period
              </Button>
            ) : null}
          </>,
        )}

        <Card className="admin-events-card admin-list-card admin-org-card">
          <CardBody flush>
            <DataTable columns={columns} rows={periodPageRows} rowKey={(r) => r.id} />
            {paginationBar}
          </CardBody>
        </Card>

        {/* Create/Edit Period popup: Period (its years, which set the dates) and Cabinet.
            Cancel keeps the list. */}
        <Modal
          open={periodModal !== null}
          title={periodModal?.mode === "edit" ? "Edit Period" : "Create Period"}
          width={520}
          hideClose
          onClose={() => setPeriodModal(null)}
          footer={
            <div className="admin-modal__footer-row">
              <Button variant="outline" icon="chevronLeft" onClick={() => setPeriodModal(null)}>
                Back
              </Button>
              <Button
                variant="primary"
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
              // Same rules as PeriodFormSchema (the server checks them again).
              [
                "name",
                "Period *",
                "e.g 2026-2027",
                {
                  pattern: String.raw`\s*\d{4}\s*(?:-|/)\s*\d{4}\s*`,
                  title: "The years of the period, e.g. 2026-2027",
                },
              ],
              ["cabinet", "Cabinet *", "Cabinet Name", { minLength: 2 }],
            ] as const
          ).map(([key, text, placeholder, rules]) => (
            <div className="admin-field" key={key}>
              <label className="admin-field__label" htmlFor={`org-period-${key}`}>
                {text}
              </label>
              <input
                id={`org-period-${key}`}
                className="admin-input"
                required
                {...rules}
                placeholder={placeholder}
                defaultValue={periodModal?.mode === "edit" ? periodModal.item[key] : ""}
                aria-invalid={periodErrors[key] ? true : undefined}
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

        {deleteDialog}
        <ToastBanner message={toast.message} />
      </div>
    );
  }

  /* ================================================================
     PPI LIST
     ================================================================ */

  const checkbox = (labelText: string, checked: boolean, onChange: () => void, some = false) => (
    <label className="admin-checkbox">
      <input
        type="checkbox"
        aria-label={labelText}
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = some && !checked;
        }}
        onChange={onChange}
        className="admin-table__checkbox"
      />
      <span aria-hidden="true" />
    </label>
  );

  const columns: Column<ChapterItem>[] = [
    ...(canEdit
      ? [
          {
            key: "check",
            width: "24px",
            align: "left" as const,
            header: checkbox("Select all on page", pageSelected, toggleAllPage, pageSomeSelected),
            render: (r: ChapterItem) =>
              checkbox(`Select ${r.name}`, selected.has(r.id), () => toggleOne(r.id)),
          },
        ]
      : []),
    {
      key: "name",
      header: (
        <SortHeader
          label="PPI"
          active={ppiSort === "name"}
          dir={sortDir}
          onClick={() => sortBy(ppiSort, "name", setPpiSort)}
        />
      ),
      width: "18%",
      render: (r) => (
        <div>
          <div className="admin-table__title">{r.name}</div>
          <div className="admin-table__sub admin-org-code">#{r.countryCode}</div>
        </div>
      ),
    },
    {
      key: "country",
      header: (
        <SortHeader
          label="Country"
          active={ppiSort === "country"}
          dir={sortDir}
          onClick={() => sortBy(ppiSort, "country", setPpiSort)}
        />
      ),
      width: "12%",
      render: (r) => <span>{r.country}</span>,
    },
    {
      key: "timezone",
      header: "Timezone",
      width: "18%",
      render: (r) => (
        <span className="admin-table__title">
          {r.timezone} ({r.utcOffset})
        </span>
      ),
    },
    {
      key: "members",
      header: (
        <SortHeader
          label="Members"
          active={ppiSort === "memberCount"}
          dir={sortDir}
          onClick={() => sortBy(ppiSort, "memberCount", setPpiSort)}
        />
      ),
      width: "9%",
      render: (r) => <span className="admin-table__title">{r.memberCount}</span>,
    },
    {
      key: "conditions",
      header: "Conditions",
      width: "16%",
      render: (r) => <span className="admin-org-conditions">{r.conditions.join(" · ")}</span>,
    },
    {
      key: "status",
      header: "Status",
      width: "14%",
      render: (r) => (
        <div className="admin-org-badges">
          {r.risk !== "none" ? statusChip(label(CHAPTER_RISK_LABELS, r.risk)) : null}
          {statusChip(r.active ? "Active" : "Inactive")}
        </div>
      ),
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      width: "9%",
      render: (r) =>
        canEdit || contactEditIds.includes(r.id) ? (
          <div className="admin-table__actions">
            {canEdit ? (
              <Button
                variant="ghost"
                size="icon"
                icon="trash"
                className="admin-btn--icon-danger"
                aria-label={`Delete ${r.name}`}
                title="Delete"
                onClick={() => setDeleting({ kind: "ppis", items: [r] })}
              />
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              icon="edit"
              aria-label={`Edit ${r.name}`}
              title="Edit"
              onClick={() => setChapterForm(r)}
            />
          </div>
        ) : null,
    },
  ];

  const allSelected = ppis.length > 0 && selected.size === ppis.length;

  return (
    <div>
      {header(
        "Organizations > PPI",
        <>
          <Button variant="outline" size="sm" icon="download" onClick={exportPpisCsv}>
            Export CSV
          </Button>
          {canEdit ? (
            <Button variant="outline" size="sm" icon="plus" onClick={() => setChapterForm("new")}>
              Add New PPI
            </Button>
          ) : null}
        </>,
      )}

      <Card className="admin-events-card admin-list-card admin-org-card">
        <CardBody flush>
          <DataTable columns={columns} rows={ppiPageRows} rowKey={(r) => r.id} />

          {selected.size > 0 ? (
            /* Bulk action bar (Figma: floats above the pagination while rows are selected). */
            <div className="admin-bulkbar admin-org-bulkbar">
              <span className="admin-bulkbar__summary">
                {checkbox(
                  "Select all PPIs",
                  allSelected,
                  () => setSelected(allSelected ? new Set() : new Set(ppis.map((p) => p.id))),
                  true,
                )}
                {selected.size} selected
              </span>
              {!allSelected ? (
                <button
                  type="button"
                  className="admin-bulkbar__select-all"
                  onClick={() => setSelected(new Set(ppis.map((p) => p.id)))}
                >
                  Select all {ppis.length} ppis
                </button>
              ) : null}
              <div className="admin-bulkbar__actions">
                <Button
                  variant="danger"
                  size="sm"
                  icon="trash"
                  disabled={busy}
                  onClick={() =>
                    setDeleting({ kind: "ppis", items: ppis.filter((p) => selected.has(p.id)) })
                  }
                >
                  Delete
                </Button>
              </div>
            </div>
          ) : null}
          {paginationBar}
        </CardBody>
      </Card>

      {chapterForm !== null ? (
        <ChapterForm
          chapter={chapterForm === "new" ? null : chapterForm}
          contactOnly={!canEdit}
          onClose={() => setChapterForm(null)}
          onSaved={(text) => {
            setChapterForm(null);
            router.refresh();
            toast.show(text);
          }}
        />
      ) : null}

      {deleteDialog}
      <ToastBanner message={toast.message} />
    </div>
  );
}
