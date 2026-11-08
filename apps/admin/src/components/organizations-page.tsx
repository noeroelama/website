"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  activatePeriodAction,
  addUniversityAction,
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
import { DataTable, Pagination, type Column } from "@/components/ui/data-table";
import { MenuDivider, MenuItem, RowMenu, Tabs, useListTable } from "@/components/ui/list-controls";
import { Modal } from "@/components/ui/modal";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { CHAPTER_RISK_LABELS, label } from "@/labels";
import type { ChapterItem } from "./chapters-model";
import type { PeriodItem } from "./periods-model";
import { Select } from "@/components/ui/select";
import { ReviewQueue, type ProposalRow } from "./university-review-queue";

export const ORG_SUBTITLE =
  "Manage the board periods, their structure and the PPI chapters shown on the public site.";

export type OrgView = "period" | "ppi" | "universities";

export interface UniversitiesTabData {
  country: string;
  countries: { code: string; name: string }[];
  approved: { id: string; name: string; city: string | null; source: "ror" | "manual" }[];
  requests: ProposalRow[];
  canEdit: boolean;
}

type PeriodModalState = { mode: "create" } | { mode: "edit"; item: PeriodItem } | null;

type DeleteState =
  { kind: "period"; item: PeriodItem } | { kind: "ppis"; items: ChapterItem[] } | null;

export function OrgTabs({
  view,
  onSelect,
  showPeriod = true,
  showUniversities = false,
}: {
  view: OrgView;
  onSelect?: (view: OrgView) => void;
  showPeriod?: boolean;
  showUniversities?: boolean;
}) {
  const router = useRouter();
  const tabs: { key: OrgView; label: string }[] = [
    ...(showPeriod ? [{ key: "period" as const, label: "Period" }] : []),
    { key: "ppi", label: "PPI" },
    ...(showUniversities ? [{ key: "universities" as const, label: "Universities" }] : []),
  ];
  return (
    <Tabs
      label="Organization lists"
      tabs={tabs}
      active={view}
      onSelect={(key) =>
        onSelect
          ? onSelect(key)
          : router.push(key === "period" ? "/organizations" : `/organizations?view=${key}`)
      }
    />
  );
}

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

type PeriodSortKey = "name" | "status";

type PpiSortKey = "name" | "country" | "memberCount";

const periodSortValue = (r: PeriodItem, key: PeriodSortKey) => r[key];
const ppiSortValue = (r: ChapterItem, key: PpiSortKey) => r[key];
const periodFilterText = (r: PeriodItem, key: PeriodSortKey) =>
  key === "status" ? (r.status === "active" ? "Active" : "Inactive") : r.name;
const ppiFilterText = (r: ChapterItem, key: PpiSortKey) => String(r[key]);
const universitySortValue = (r: { name: string }, key: "name") => r[key];

const statusChip = (text: string) => <span className="admin-status-badge">{text}</span>;

interface OrganizationsProps {
  chapters: ChapterItem[];
  signals: Record<string, string>;
  canEdit: boolean;
  contactEditIds: string[];
  periods: PeriodItem[] | null;
  canEditPeriods: boolean;
  universities: UniversitiesTabData | null;
  initialView: OrgView;
}

export function OrganizationsPage(props: OrganizationsProps) {
  const pathname = usePathname();
  return <OrganizationsList key={pathname} {...props} />;
}

function OrganizationsList({
  chapters: ppis,
  signals,
  canEdit,
  contactEditIds,
  periods: periodList,
  canEditPeriods,
  universities,
  initialView,
}: OrganizationsProps) {
  const periods = useMemo(() => periodList ?? [], [periodList]);
  const toast = useToastMessage();
  const router = useRouter();
  const nextMapNo = useMemo(
    () => ppis.reduce((max, c) => Math.max(max, c.mapNo ?? 0), 0) + 1,
    [ppis],
  );
  const [chapterForm, setChapterForm] = useState<ChapterItem | "new" | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<OrgView>(
    (initialView === "period" && !periodList) || (initialView === "universities" && !universities)
      ? "ppi"
      : initialView,
  );
  const [universityModal, setUniversityModal] = useState<"add" | "requests" | null>(null);
  const [universityErrors, setUniversityErrors] = useState<Readonly<Record<string, string>>>({});
  const [periodModal, setPeriodModal] = useState<PeriodModalState>(null);
  const [periodErrors, setPeriodErrors] = useState<Readonly<Record<string, string>>>({});
  const [activating, setActivating] = useState<PeriodItem | null>(null);
  const [deleting, setDeleting] = useState<DeleteState>(null);
  const periodTable = useListTable(periods, periodSortValue, undefined, periodFilterText);
  const ppiTable = useListTable(ppis, ppiSortValue, undefined, ppiFilterText);
  const universityRows = useMemo(() => universities?.approved ?? [], [universities]);
  const universityTable = useListTable(universityRows, universitySortValue);
  const { selected } = ppiTable;
  const switchView = (next: OrgView) => setView(next);

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

  const addUniversity = async () => {
    if (!universities) return;
    const value = (id: string) =>
      document.querySelector<HTMLInputElement>(`#org-university-${id}`)?.value ?? "";
    setBusy(true);
    const result = await addUniversityAction({
      name: value("name"),
      countryCode: universities.country,
      city: value("city"),
    });
    setBusy(false);
    if (!result.ok) {
      setUniversityErrors(result.fields ?? {});
      return toast.show(actionMessage(result));
    }
    setUniversityModal(null);
    setUniversityErrors({});
    router.refresh();
    toast.show("Campus added");
  };

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
    ppiTable.clearSelection();
    router.refresh();
    if (failure) return toast.show(failure);
    toast.show(
      deleting.kind === "period"
        ? `Period ${deleting.item.name} deleted`
        : `${count} PPI${count === 1 ? "" : "s"} deleted`,
    );
  };

  const table = view === "period" ? periodTable : view === "ppi" ? ppiTable : universityTable;
  const paginationBar = (
    <Pagination
      page={table.page}
      pageSize={table.pageSize}
      totalItems={table.sorted.length}
      onPageChange={table.setPage}
      onPageSizeChange={table.setPageSize}
    />
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
      <OrgTabs
        view={view}
        onSelect={switchView}
        showPeriod={periodList !== null}
        showUniversities={universities !== null}
      />
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

  if (view === "period") {
    const columns: Column<PeriodItem>[] = [
      {
        key: "name",
        header: periodTable.header("name", "Period"),
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
        header: periodTable.header("status", "Status"),
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
                  setPeriodErrors({});
                  setPeriodModal({ mode: "edit", item: r });
                }}
              />
            ) : null}
            <RowMenu>
              <MenuItem
                icon="settings"
                onClick={() => router.push(`/organizations/periods/${r.id}`)}
              >
                Manage Structure
              </MenuItem>
              {canEditPeriods && r.status === "draft" ? (
                <MenuItem icon="globe" onClick={() => setActivating(r)}>
                  Set as Active
                </MenuItem>
              ) : null}
              {canEditPeriods && r.status !== "active" ? (
                <>
                  <MenuDivider />
                  <MenuItem
                    icon="trash"
                    danger
                    onClick={() => setDeleting({ kind: "period", item: r })}
                  >
                    Delete Period
                  </MenuItem>
                </>
              ) : null}
            </RowMenu>
          </div>
        ),
      },
    ];

    return (
      <div>
        {header(
          "Organizations > Period",
          <div className="admin-fab">
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
          </div>,
        )}

        <Card className="admin-events-card admin-list-card admin-org-card">
          <CardBody flush>
            <DataTable columns={columns} rows={periodTable.pageRows} rowKey={(r) => r.id} />
            {paginationBar}
          </CardBody>
        </Card>

        <Modal
          asForm
          open={periodModal !== null}
          title={periodModal?.mode === "edit" ? "Edit Period" : "Create Period"}
          onClose={() => setPeriodModal(null)}
          footer={
            <div className="admin-modal__footer-row">
              <Button variant="outline" icon="chevronLeft" onClick={() => setPeriodModal(null)}>
                Back
              </Button>
              <Button
                type="submit"
                variant="primary"
                icon="cloud"
                disabled={busy}
                onClick={() => savePeriod()}
              >
                Save
              </Button>
            </div>
          }
        >
          {(
            [
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

  if (view === "universities" && universities) {
    const countryName =
      universities.countries.find((c) => c.code === universities.country)?.name ??
      universities.country;
    const columns: Column<UniversitiesTabData["approved"][number]>[] = [
      {
        key: "name",
        header: "Campus",
        render: (r) => <span className="admin-table__title">{r.name}</span>,
      },
      { key: "city", header: "City", render: (r) => r.city ?? "—" },
      {
        key: "source",
        header: "Source",
        render: (r) => statusChip(r.source === "ror" ? "ROR" : "Added"),
      },
    ];
    return (
      <div>
        {header(
          "Organizations > Universities",
          <div className="admin-fab">
            <Select
              className="admin-select"
              aria-label="Country"
              value={universities.country}
              onChange={(e) =>
                router.push(`/organizations?view=universities&country=${e.target.value}`)
              }
            >
              {universities.countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Button
              variant="outline"
              size="sm"
              icon="inbox"
              onClick={() => setUniversityModal("requests")}
            >
              Requested ({universities.requests.length})
            </Button>
            {universities.canEdit && universities.country ? (
              <Button
                variant="outline"
                size="sm"
                icon="plus"
                onClick={() => {
                  setUniversityErrors({});
                  setUniversityModal("add");
                }}
              >
                Add University
              </Button>
            ) : null}
          </div>,
        )}

        <Card className="admin-events-card admin-list-card admin-org-card">
          <CardBody flush>
            <DataTable
              columns={columns}
              rows={universityTable.pageRows}
              rowKey={(r) => r.id}
              emptyText={`No listed campus in ${countryName} yet`}
            />
            {paginationBar}
          </CardBody>
        </Card>

        <Modal
          asForm
          open={universityModal === "add"}
          title="Add University"
          subtitle={`Listed right away for members in ${countryName}.`}
          onClose={() => setUniversityModal(null)}
          footer={
            <div className="admin-modal__footer-row">
              <Button variant="outline" icon="chevronLeft" onClick={() => setUniversityModal(null)}>
                Back
              </Button>
              <Button
                type="submit"
                variant="primary"
                icon="cloud"
                disabled={busy}
                onClick={() => void addUniversity()}
              >
                Save
              </Button>
            </div>
          }
        >
          {(
            [
              ["name", "Campus name *", "e.g. Kyoto University", true, 3, 200],
              ["city", "City", "e.g. Kyoto", false, 0, 100],
            ] as const
          ).map(([key, text, placeholder, required, minLength, maxLength]) => (
            <div className="admin-field" key={key}>
              <label className="admin-field__label" htmlFor={`org-university-${key}`}>
                {text}
              </label>
              <input
                id={`org-university-${key}`}
                className="admin-input"
                required={required}
                minLength={minLength}
                maxLength={maxLength}
                placeholder={placeholder}
                aria-invalid={universityErrors[key] ? true : undefined}
                aria-describedby={`org-university-${key}-error`}
              />
              <FieldError id={`org-university-${key}-error`} message={universityErrors[key]} />
            </div>
          ))}
        </Modal>

        <Modal
          open={universityModal === "requests"}
          title="Requested Universities"
          subtitle="Campuses members proposed because they were not listed. Accept a real campus, merge a duplicate into the listed one (members follow it), or reject."
          width={960}
          onClose={() => setUniversityModal(null)}
        >
          <ReviewQueue rows={universities.requests} canEdit={universities.canEdit} />
        </Modal>

        <ToastBanner message={toast.message} />
      </div>
    );
  }

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
            header: checkbox(
              "Select all on page",
              ppiTable.pageAll,
              ppiTable.togglePage,
              ppiTable.pageSome,
            ),
            render: (r: ChapterItem) =>
              checkbox(`Select ${r.name}`, selected.has(r.id), () => ppiTable.toggle(r.id)),
          },
        ]
      : []),
    {
      key: "name",
      header: ppiTable.header("name", "PPI"),
      width: "18%",
      render: (r) => (
        <div>
          <a className="admin-table__title" href={`/organizations/chapters/${r.id}`}>
            {r.name}
          </a>
          <div className="admin-table__sub admin-org-code">
            #{r.countryCode}
            {r.mapNo !== null ? ` · №${r.mapNo}` : ""}
          </div>
        </div>
      ),
    },
    {
      key: "country",
      header: ppiTable.header("country", "Country"),
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
      header: ppiTable.header("memberCount", "Members"),
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
          {signals[r.id] ? statusChip(signals[r.id] as string) : null}
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

  const { allSelected } = ppiTable;

  return (
    <div>
      {header(
        "Organizations > PPI",
        <div className="admin-fab">
          <Button variant="outline" size="sm" icon="download" onClick={exportPpisCsv}>
            Export CSV
          </Button>
          {canEdit ? (
            <Button variant="outline" size="sm" icon="plus" onClick={() => setChapterForm("new")}>
              Add New PPI
            </Button>
          ) : null}
        </div>,
      )}

      <Card className="admin-events-card admin-list-card admin-org-card">
        <CardBody flush>
          <DataTable columns={columns} rows={ppiTable.pageRows} rowKey={(r) => r.id} />

          {selected.size > 0 ? (
            <div className="admin-bulkbar admin-org-bulkbar">
              <span className="admin-bulkbar__summary">
                {checkbox("Select all PPIs", allSelected, ppiTable.toggleAll, true)}
                {selected.size} selected
              </span>
              {!allSelected ? (
                <button
                  type="button"
                  className="admin-bulkbar__select-all"
                  onClick={ppiTable.toggleAll}
                >
                  Select all {ppiTable.sorted.length} ppis
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
          suggestedMapNo={nextMapNo}
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
