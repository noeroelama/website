"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { utcToWallTime, wallTimeToUtc } from "@website/domain/shared";
import {
  removeRecruitmentAction,
  saveRecruitmentAction,
  setRecruitmentPublishedAction,
} from "@/app/(panel)/recruitment/actions";
import { actionMessage } from "@/components/action-message";
import { formatInZone } from "@/components/format";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, DELETE_HINT } from "@/components/ui/confirm-dialog";
import { SortHeader, type Column } from "@/components/ui/data-table";
import { FieldError } from "@/components/ui/field-error";
import { Icon } from "@/components/ui/icon";
import {
  ListCard,
  ListEmpty,
  MenuDivider,
  MenuItem,
  RowMenu,
  useBulkActions,
  useListTable,
} from "@/components/ui/list-controls";
import { Select } from "@/components/ui/select";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { unitDrafts, unitsInput, type RecruitmentItem, type UnitDraft } from "./recruitment-model";

/* ==================================================================
   Recruitment (Oprec) — set-up: window, units with seat quotas and
   portfolio rule, choices, offer validity and the recruitment form.
   Applications (review, offers, interviews) follow in the queue.
   ================================================================== */

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

type SortKey = "title" | "opens";
const sortValue = (r: RecruitmentItem, key: SortKey) =>
  key === "title" ? r.title.toLowerCase() : r.opensAt;

interface Draft {
  periodId: string;
  title: string;
  description: string;
  opensAt: string;
  closesAt: string;
  maxChoices: string;
  offerDays: string;
  formId: string;
  units: UnitDraft[];
}

interface Props {
  initial: RecruitmentItem[];
  /** Periods that can still change (draft or active). */
  periods: { id: string; name: string }[];
  /** The units of each of those periods, in tree order. */
  unitsByPeriod: Record<string, { id: string; name: string; path: string[] }[]>;
  /** Recruitment-usage forms. */
  forms: { id: string; title: string; currentVersion: number }[];
  canEdit: boolean;
}

export function RecruitmentPage(props: Props) {
  const pathname = usePathname();
  return <RecruitmentList key={pathname} {...props} />;
}

function RecruitmentList({ initial: items, periods, unitsByPeriod, forms, canEdit }: Props) {
  const toast = useToastMessage();
  const router = useRouter();
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [view, setView] = useState<"list" | "form">("list");
  const [editing, setEditing] = useState<RecruitmentItem | null>(null);
  const [zone, setZone] = useState("UTC");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<RecruitmentItem | null>(null);

  const table = useListTable(items, sortValue);
  type Failure = Parameters<typeof actionMessage>[0];
  const fail = (result: Failure) => {
    setFieldErrors(result.fields ?? {});
    toast.show(actionMessage(result));
  };
  const bulk = useBulkActions({
    noun: "recruitment",
    show: toast.show,
    onFailure: fail,
    onFinish: table.clearSelection,
  });
  const { busy, setBusy } = bulk;

  const open = (r?: RecruitmentItem) => {
    const editorZone = browserZone();
    const wall = (iso: string) => utcToWallTime(new Date(iso), editorZone);
    const periodId = r?.periodId ?? periods[0]?.id ?? "";
    setZone(editorZone);
    setEditing(r ?? null);
    setFieldErrors({});
    setDraft({
      periodId,
      title: r?.title ?? "",
      description: r?.description ?? "",
      opensAt: r ? wall(r.opensAt) : "",
      closesAt: r ? wall(r.closesAt) : "",
      maxChoices: String(r?.maxChoices ?? 2),
      offerDays: String(r?.offerDays ?? 3),
      formId: r?.formId ?? forms[0]?.id ?? "",
      units: unitDrafts(unitsByPeriod[periodId] ?? [], r?.units ?? []),
    });
    setView("form");
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    const result = await saveRecruitmentAction({
      ...(editing ? { id: editing.id } : {}),
      version: editing?.version ?? null,
      periodId: draft.periodId,
      title: draft.title,
      description: draft.description,
      opensAt: wallTimeToUtc(draft.opensAt, zone)?.toISOString() ?? "",
      closesAt: wallTimeToUtc(draft.closesAt, zone)?.toISOString() ?? "",
      maxChoices: Number(draft.maxChoices),
      offerDays: Number(draft.offerDays),
      formId: draft.formId,
      units: unitsInput(draft.units),
    });
    setBusy(false);
    if (!result.ok) {
      fail(result);
      return;
    }
    toast.show(`Recruitment saved (applicants answer form version ${result.data.formVersion})`);
    router.refresh();
    setView("list");
  };

  const updateUnit = (i: number, patch: Partial<UnitDraft>) =>
    setDraft(
      (d) => d && { ...d, units: d.units.map((u, j) => (j === i ? { ...u, ...patch } : u)) },
    );

  const setPublished = (r: RecruitmentItem, published: boolean) =>
    void bulk.run(
      [r],
      (x) => setRecruitmentPublishedAction({ id: x.id, version: x.version, published }),
      published ? "published" : "unpublished",
    );

  const errorFor = (field: string, hint?: string) => (
    <FieldError id={`rec-${field}-error`} message={fieldErrors[field]} hint={hint} />
  );

  const columns: Column<RecruitmentItem>[] = [
    {
      key: "title",
      header: (
        <SortHeader
          label="Recruitment"
          active={table.sort.key === "title"}
          dir={table.sort.dir}
          onClick={() => table.onSort("title")}
        />
      ),
      width: "34%",
      render: (r) => (
        <div>
          <div className="admin-table__title">{r.title}</div>
          <div className="admin-table__sub">Period {r.periodName}</div>
        </div>
      ),
    },
    {
      key: "opens",
      header: (
        <SortHeader
          label="Window (UTC)"
          active={table.sort.key === "opens"}
          dir={table.sort.dir}
          onClick={() => table.onSort("opens")}
        />
      ),
      width: "26%",
      render: (r) => (
        <span className="admin-event-meta">
          <span className="admin-table__title">{formatInZone(r.opensAt, "UTC")}</span>
          <span className="admin-table__sub">until {formatInZone(r.closesAt, "UTC")}</span>
        </span>
      ),
    },
    {
      key: "units",
      header: "Seats",
      width: "16%",
      render: (r) => (
        <span className="admin-event-meta">
          <span className="admin-table__title">
            {r.units.reduce((n, u) => n + u.filled, 0)} / {r.units.reduce((n, u) => n + u.quota, 0)}
          </span>
          <span className="admin-table__sub">{r.units.length} units</span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "14%",
      render: (r) => (
        <span className="admin-status-badge">
          <Icon name={r.published ? "globe" : "lock"} size={12} />
          {r.open ? "Open" : r.published ? "Published" : "Draft"}
        </span>
      ),
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      width: "10%",
      render: (r) => (
        <div className="admin-table__actions">
          {canEdit ? (
            <Button
              variant="ghost"
              size="icon"
              icon="edit"
              aria-label="Edit"
              onClick={() => open(r)}
            />
          ) : null}
          <RowMenu>
            <MenuItem icon="inbox" onClick={() => router.push(`/recruitment/${r.id}/applications`)}>
              Applications
            </MenuItem>
            {canEdit ? (
              <>
                <MenuItem
                  icon="globe"
                  disabled={busy || r.published}
                  onClick={() => setPublished(r, true)}
                >
                  Publish
                </MenuItem>
                <MenuItem
                  icon="lock"
                  disabled={busy || !r.published}
                  onClick={() => setPublished(r, false)}
                >
                  Unpublish
                </MenuItem>
                <MenuDivider />
                <MenuItem icon="trash" danger onClick={() => setDeleting(r)}>
                  Delete Recruitment
                </MenuItem>
              </>
            ) : null}
          </RowMenu>
        </div>
      ),
    },
  ];

  if (view === "form" && draft) {
    return (
      <div>
        <div className="admin-page-header">
          <div>
            <h1 className="admin-page-header__title">
              {editing ? "Recruitment > Edit" : "Recruitment > Create"}
            </h1>
            <p className="admin-page-header__desc">
              Applicants answer the chosen form&apos;s current version. Seat quotas live in one
              counter per unit; a quota never goes below the seats already accepted.
            </p>
          </div>
        </div>
        <div className="admin-dark-form">
          <div className="admin-form-grid">
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="rec-title">
                Title *
              </label>
              <input
                id="rec-title"
                required
                minLength={3}
                className="admin-input"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
              {errorFor("title")}
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="rec-period">
                Board period *
              </label>
              <Select
                id="rec-period"
                className="admin-select"
                value={draft.periodId}
                disabled={editing !== null}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    periodId: e.target.value,
                    units: unitDrafts(unitsByPeriod[e.target.value] ?? [], []),
                  })
                }
              >
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              {errorFor("periodId")}
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="rec-opens">
                Opens *
              </label>
              <input
                id="rec-opens"
                required
                className="admin-input"
                type="datetime-local"
                value={draft.opensAt}
                onChange={(e) => setDraft({ ...draft, opensAt: e.target.value })}
              />
              {errorFor("opensAt", `Your time zone (${zone}).`)}
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="rec-closes">
                Closes *
              </label>
              <input
                id="rec-closes"
                required
                className="admin-input"
                type="datetime-local"
                value={draft.closesAt}
                onChange={(e) => setDraft({ ...draft, closesAt: e.target.value })}
              />
              {errorFor("closesAt")}
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="rec-choices">
                Choices per applicant *
              </label>
              <input
                id="rec-choices"
                required
                className="admin-input"
                type="number"
                min={1}
                max={5}
                value={draft.maxChoices}
                onChange={(e) => setDraft({ ...draft, maxChoices: e.target.value })}
              />
              {errorFor("maxChoices", "1 to 5 ordered unit choices.")}
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="rec-offer">
                Offer valid for (days) *
              </label>
              <input
                id="rec-offer"
                required
                className="admin-input"
                type="number"
                min={1}
                max={60}
                value={draft.offerDays}
                onChange={(e) => setDraft({ ...draft, offerDays: e.target.value })}
              />
              {errorFor("offerDays")}
            </div>
            <div className="admin-field admin-form-grid__full">
              <label className="admin-field__label" htmlFor="rec-form">
                Application form *
              </label>
              <Select
                id="rec-form"
                className="admin-select"
                value={draft.formId}
                onChange={(e) => setDraft({ ...draft, formId: e.target.value })}
              >
                {forms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title} (version {f.currentVersion})
                  </option>
                ))}
              </Select>
              {errorFor("formId", "Forms whose use is “Recruitment form” (Forms page).")}
            </div>
            <div className="admin-field admin-form-grid__full">
              <label className="admin-field__label" htmlFor="rec-desc">
                Description
              </label>
              <textarea
                id="rec-desc"
                className="admin-input admin-textarea"
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
              {errorFor("description")}
            </div>
          </div>

          <div className="admin-form-separator">
            <span className="admin-field__label">Units offered *</span>
            {draft.units.length === 0 ? (
              <span className="admin-card__subtitle">This period has no units yet.</span>
            ) : (
              <div className="admin-recruit-units">
                {draft.units.map((u, i) => (
                  <div key={u.orgUnitId} className="admin-recruit-unit">
                    <label
                      className="admin-check-label"
                      style={{ paddingLeft: `calc(var(--space-4) * ${u.depth})` }}
                    >
                      <input
                        type="checkbox"
                        checked={u.offered}
                        disabled={u.filled > 0}
                        onChange={(e) => updateUnit(i, { offered: e.target.checked })}
                      />
                      {u.name}
                    </label>
                    {u.offered ? (
                      <>
                        <input
                          className="admin-input admin-recruit-unit__quota"
                          type="number"
                          min={Math.max(1, u.filled)}
                          aria-label={`Seats in ${u.name}`}
                          value={u.quota}
                          onChange={(e) => updateUnit(i, { quota: e.target.value })}
                        />
                        <label className="admin-check-label">
                          <input
                            type="checkbox"
                            checked={u.portfolioRequired}
                            onChange={(e) => updateUnit(i, { portfolioRequired: e.target.checked })}
                          />
                          Portfolio
                        </label>
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
            {errorFor("units")}
          </div>

          <div className="admin-form-actions admin-form-grid__full">
            <Button variant="outline" size="sm" icon="chevronLeft" onClick={() => setView("list")}>
              Back
            </Button>
            <div className="admin-form-actions__right">
              <Button
                variant="outline"
                size="sm"
                icon="cloud"
                disabled={busy}
                onClick={() => void save()}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
        <ToastBanner message={toast.message} />
      </div>
    );
  }

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Recruitment</h1>
          <p className="admin-page-header__desc">
            Open recruitment (Oprec): window, units and seats, portfolio rules and the application
            form.
          </p>
        </div>
        <div className="admin-page-header__actions">
          {canEdit ? (
            <Button
              variant="outline"
              size="sm"
              icon="plus"
              disabled={periods.length === 0 || forms.length === 0}
              title={
                forms.length === 0 ? "Create a recruitment form on the Forms page first" : undefined
              }
              onClick={() => open()}
            >
              Add Recruitment
            </Button>
          ) : null}
        </div>
      </div>
      <ListCard
        table={table}
        total={items.length}
        noun="recruitment"
        columns={columns}
        empty={
          <ListEmpty
            noun="recruitment"
            query=""
            filters={0}
            emptyHint="Add the first recruitment."
            onClear={() => undefined}
          />
        }
      />
      <ConfirmDialog
        open={deleting !== null}
        title="Delete Recruitment?"
        confirmLabel="Delete Recruitment"
        icon="trash"
        onConfirm={() => {
          const r = deleting;
          setDeleting(null);
          if (r)
            void bulk.run(
              [r],
              (x) => removeRecruitmentAction({ id: x.id, version: x.version }),
              "deleted",
            );
        }}
        onCancel={() => setDeleting(null)}
      >
        {DELETE_HINT}
      </ConfirmDialog>
      <ToastBanner message={toast.message} />
    </div>
  );
}
