"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ORG_UNIT_TYPES, type OrgUnitType } from "@website/domain/organizations";
import { moveOrgUnitAction, saveOrgUnitAction } from "@/app/(panel)/organizations/actions";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FieldError } from "@/components/ui/field-error";
import { Modal } from "@/components/ui/modal";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { label, ORG_UNIT_TYPE_LABELS } from "@/labels";
import { AppointModal, RoleMapModal, UnitPeople, type AppointmentItem } from "./appointment-forms";
import type { AppointmentRoleMap } from "@website/domain/organizations";
import type { OrgUnitItem } from "./org-units-model";
import type { PeriodItem } from "./periods-model";

interface Props {
  period: PeriodItem;
  /** Every period, for the period switch. */
  periods: PeriodItem[];
  /** The period's units in tree order. */
  units: OrgUnitItem[];
  /** structure.edit and the period is not archived. */
  canEdit: boolean;
  /** Active appointments of the period (empty without appointments.read). */
  appointments: AppointmentItem[];
  /** appointments.edit and this is the active period. */
  canAppoint: boolean;
  /** roles.edit: the seat → role mapping (null = not set yet); undefined = cannot edit it. */
  roleMap: { map: AppointmentRoleMap; version: number } | null | undefined;
  /** Custom roles for the mapping. */
  roles: { id: string; name: string }[];
}

interface UnitForm {
  name: string;
  code: string;
  type: OrgUnitType;
  parentId: string | null;
  description: string;
  sort: string;
  active: boolean;
}

const fromUnit = (u: OrgUnitItem | null, parentId: string | null): UnitForm => ({
  name: u?.name ?? "",
  code: u?.code ?? "",
  type: u?.type ?? "direktorat",
  parentId: u ? u.parentId : parentId,
  description: u?.description ?? "",
  sort: String(u?.sort ?? 0),
  active: u?.active ?? true,
});

/** Indented unit name for tables and pickers. */
const treeLabel = (u: OrgUnitItem) => `${"— ".repeat(u.path.length)}${u.name} (${u.code})`;

/**
 * Organizations → Period → Structure (feature A5): the unit tree of one period. Units are added
 * and edited here; Move puts a unit (with everything below it) under another unit. An archived
 * period is read-only. Units are deactivated, never deleted.
 */
export function OrgStructurePage({
  period,
  periods,
  units,
  canEdit,
  appointments,
  canAppoint,
  roleMap,
  roles,
}: Props) {
  const router = useRouter();
  const toast = useToastMessage();
  const [busy, setBusy] = useState(false);
  /* Unit form: null = closed; unit = edit; { parentId } = add under that parent. */
  const [editing, setEditing] = useState<OrgUnitItem | { parentId: string | null } | null>(null);
  const [form, setForm] = useState<UnitForm>(() => fromUnit(null, null));
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [moving, setMoving] = useState<OrgUnitItem | null>(null);
  const [moveTo, setMoveTo] = useState<string>("");
  const [appointTo, setAppointTo] = useState<OrgUnitItem | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const done = (text: string) => {
    setAppointTo(null);
    setMapOpen(false);
    router.refresh();
    toast.show(text);
  };

  const editedUnit = editing && "id" in editing ? editing : null;
  const set = <K extends keyof UnitForm>(key: K, value: UnitForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const openForm = (unit: OrgUnitItem | null, parentId: string | null = null) => {
    setForm(fromUnit(unit, parentId));
    setErrors({});
    setEditing(unit ?? { parentId });
  };

  const save = async () => {
    setBusy(true);
    const result = await saveOrgUnitAction({
      ...(editedUnit ? { id: editedUnit.id } : {}),
      version: editedUnit?.version ?? null,
      periodId: period.id,
      ...form,
      sort: Number(form.sort),
    });
    setBusy(false);
    if (!result.ok) {
      setErrors(result.fields ?? {});
      return toast.show(actionMessage(result));
    }
    setEditing(null);
    router.refresh();
    toast.show(editedUnit ? "Unit saved" : "Unit created");
  };

  const move = async (unit: OrgUnitItem) => {
    setBusy(true);
    const result = await moveOrgUnitAction({
      id: unit.id,
      version: unit.version,
      parentId: moveTo || null,
    });
    setBusy(false);
    if (!result.ok) return toast.show(actionMessage(result));
    setMoving(null);
    router.refresh();
    toast.show("Unit moved");
  };

  const columns: Column<OrgUnitItem>[] = [
    {
      key: "unit",
      header: "Unit",
      width: "44%",
      render: (u) => (
        <div style={{ paddingInlineStart: `calc(var(--space-5) * ${u.path.length})` }}>
          <div className="admin-table__title">{u.name}</div>
          <div className="admin-table__sub">{u.code}</div>
          <UnitPeople
            people={appointments.filter((a) => a.orgUnitId === u.id)}
            canEdit={canAppoint}
            onDone={done}
          />
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      width: "20%",
      render: (u) => (
        <span className="admin-table__title">{label(ORG_UNIT_TYPE_LABELS, u.type)}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "14%",
      render: (u) => (
        <span
          className={u.active ? "admin-org-status" : "admin-org-status admin-org-status--inactive"}
        >
          {u.active ? "Active" : "Inactive"}
        </span>
      ),
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      width: "22%",
      render: (u) =>
        canEdit || canAppoint ? (
          <div className="admin-table__actions">
            {canAppoint ? (
              <Button
                variant="ghost"
                size="icon"
                icon="user"
                aria-label={`Appoint someone to ${u.name}`}
                title="Appoint"
                onClick={() => setAppointTo(u)}
              />
            ) : null}
            {canEdit ? (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  icon="plus"
                  aria-label={`Add a unit under ${u.name}`}
                  title="Add a unit under this one"
                  onClick={() => openForm(null, u.id)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  icon="arrowDown"
                  aria-label={`Move ${u.name}`}
                  title="Move"
                  onClick={() => {
                    setMoveTo(u.parentId ?? "");
                    setMoving(u);
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  icon="edit"
                  aria-label={`Edit ${u.name}`}
                  title="Edit"
                  onClick={() => openForm(u)}
                />
              </>
            ) : null}
          </div>
        ) : null,
    },
  ];

  /* A unit may move anywhere except into itself or below itself. */
  const moveTargets = moving
    ? units.filter((u) => u.id !== moving.id && !u.path.includes(moving.id))
    : [];

  return (
    <>
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">Organizations &gt; Period &gt; Structure</h1>
          <p className="admin-page-header__desc">
            Period {period.name}
            {period.status === "archived" ? " (archived, read-only)" : ""}
          </p>
        </div>
        <div className="admin-page-header__actions">
          <select
            className="admin-select admin-org-period"
            aria-label="Period"
            value={period.id}
            onChange={(e) => router.push(`/organizations/periods/${e.target.value}`)}
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                Period {p.name}
              </option>
            ))}
          </select>
          {canEdit ? (
            <Button
              variant="ghost"
              size="sm"
              icon="plus"
              className="admin-btn--events-add"
              onClick={() => openForm(null)}
            >
              Add New Unit
            </Button>
          ) : null}
          {roleMap !== undefined ? (
            <Button variant="outline" size="sm" icon="key" onClick={() => setMapOpen(true)}>
              Roles from appointments
            </Button>
          ) : null}
          <Button variant="outline" size="sm" icon="chevronLeft" href="/organizations">
            Back
          </Button>
        </div>
      </div>

      <Card className="admin-events-card admin-list-card admin-org-card">
        <CardBody flush>
          <DataTable
            columns={columns}
            rows={units}
            rowKey={(u) => u.id}
            emptyText="No units in this period yet."
          />
        </CardBody>
      </Card>

      <Modal
        open={editing !== null}
        title={editedUnit ? `Edit ${editedUnit.name}` : "Add New Unit"}
        width={560}
        onClose={() => setEditing(null)}
        footer={
          <div className="admin-modal__footer-row admin-modal__footer-row--end">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button variant="primary" icon="cloud" disabled={busy} onClick={() => void save()}>
              Save
            </Button>
          </div>
        }
      >
        <div className="admin-form-grid">
          {(
            [
              ["name", "Name *", "e.g. Direktorat Media"],
              ["code", "Code *", "Unique in the period, e.g. MED or MED-DSN"],
              ["sort", "Order", "Position among its siblings"],
            ] as const
          ).map(([key, text, hint]) => (
            <div className="admin-field" key={key}>
              <label className="admin-field__label" htmlFor={`unit-${key}`}>
                {text}
              </label>
              <input
                id={`unit-${key}`}
                className="admin-input"
                type={key === "sort" ? "number" : "text"}
                value={form[key]}
                onChange={(e) => set(key, e.target.value)}
                aria-invalid={errors[key] ? true : undefined}
                aria-describedby={`unit-${key}-error`}
              />
              <FieldError id={`unit-${key}-error`} message={errors[key] ?? hint} />
            </div>
          ))}
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="unit-type">
              Type *
            </label>
            <select
              id="unit-type"
              className="admin-select"
              value={form.type}
              onChange={(e) => set("type", e.target.value as OrgUnitType)}
            >
              {ORG_UNIT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {label(ORG_UNIT_TYPE_LABELS, t)}
                </option>
              ))}
            </select>
          </div>
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="unit-parent">
              Under
            </label>
            <select
              id="unit-parent"
              className="admin-select"
              value={form.parentId ?? ""}
              disabled={editedUnit !== null}
              onChange={(e) => set("parentId", e.target.value || null)}
              aria-describedby="unit-parent-error"
            >
              <option value="">Top level (e.g. the Coordinator)</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {treeLabel(u)}
                </option>
              ))}
            </select>
            <FieldError
              id="unit-parent-error"
              message={
                errors["parentId"] ??
                (editedUnit ? "Use Move to put the unit under another unit." : undefined)
              }
            />
          </div>
          <div className="admin-field admin-form-grid__full">
            <label className="admin-field__label" htmlFor="unit-description">
              Tasks and functions
            </label>
            <textarea
              id="unit-description"
              className="admin-input admin-textarea"
              rows={3}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              aria-describedby="unit-description-error"
            />
            <FieldError id="unit-description-error" message={errors["description"]} />
          </div>
          <label className="admin-checkbox admin-form-grid__full">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set("active", e.target.checked)}
            />
            <span aria-hidden="true" /> Active
          </label>
        </div>
      </Modal>

      <Modal
        open={moving !== null}
        title={`Move ${moving?.name ?? ""}`}
        width={480}
        onClose={() => setMoving(null)}
        footer={
          <div className="admin-modal__footer-row admin-modal__footer-row--end">
            <Button variant="ghost" onClick={() => setMoving(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => moving && void move(moving)}>
              Move
            </Button>
          </div>
        }
      >
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="unit-move-to">
            Put under
          </label>
          <select
            id="unit-move-to"
            className="admin-select"
            value={moveTo}
            onChange={(e) => setMoveTo(e.target.value)}
          >
            <option value="">Top level</option>
            {moveTargets.map((u) => (
              <option key={u.id} value={u.id}>
                {treeLabel(u)}
              </option>
            ))}
          </select>
          <FieldError id="unit-move-to-error" message="Every unit below it moves with it." />
        </div>
      </Modal>

      {appointTo ? (
        <AppointModal unit={appointTo} onClose={() => setAppointTo(null)} onDone={done} />
      ) : null}
      {mapOpen && roleMap !== undefined ? (
        <RoleMapModal
          open
          current={roleMap}
          roles={roles}
          onClose={() => setMapOpen(false)}
          onDone={done}
        />
      ) : null}

      <ToastBanner message={toast.message} />
    </>
  );
}
