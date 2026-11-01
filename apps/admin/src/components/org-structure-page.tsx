"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { slugify } from "@website/domain/content";
import { deleteOrgUnitAction } from "@/app/(panel)/organizations/actions";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Icon } from "@/components/ui/icon";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { label, ORG_UNIT_TYPE_LABELS } from "@/labels";
import { OrgDeleteDialog, OrgTabs, ORG_SUBTITLE } from "./organizations-page";
import type { OrgUnitItem } from "./org-units-model";
import type { PeriodItem } from "./periods-model";

interface Props {
  period: PeriodItem;
  /** Every period, for the period switch. */
  periods: PeriodItem[];
  /** The period's units. */
  units: OrgUnitItem[];
  /** structure.edit and the period is not archived. */
  canEdit: boolean;
}

/**
 * Organizations → Period → Structure (feature A5): the units of one period with how many people
 * each shows on its cabinet page. Add and Edit open the unit page
 * (/organizations/periods/[id]/units/…); Delete is soft (revertible in the Audit Log).
 */
export function OrgStructurePage({ period, periods, units, canEdit }: Props) {
  const router = useRouter();
  const toast = useToastMessage();
  const [busy, setBusy] = useState(false);
  const [periodMenu, setPeriodMenu] = useState(false);
  const [deleting, setDeleting] = useState<OrgUnitItem | null>(null);
  const unitsPath = `/organizations/periods/${period.id}/units`;

  const remove = async (unit: OrgUnitItem) => {
    setBusy(true);
    const result = await deleteOrgUnitAction({ id: unit.id, version: unit.version });
    setBusy(false);
    setDeleting(null);
    if (!result.ok) return toast.show(actionMessage(result));
    router.refresh();
    toast.show(`${unit.name} deleted`);
  };

  const columns: Column<OrgUnitItem>[] = [
    {
      key: "unit",
      header: "Unit",
      width: "50%",
      render: (u) => (
        <div>
          <div className="admin-table__title">{u.name}</div>
          <div className="admin-table__sub">{slugify(u.name)}</div>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      width: "25%",
      render: (u) => (
        <span className="admin-table__title">{label(ORG_UNIT_TYPE_LABELS, u.type, "id")}</span>
      ),
    },
    {
      key: "people",
      header: "People",
      width: "15%",
      render: (u) => (
        <span className="admin-table__title">
          {u.people} {u.people === 1 ? "Person" : "People"}
        </span>
      ),
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      width: "10%",
      render: (u) =>
        canEdit ? (
          <div className="admin-table__actions">
            <Button
              variant="ghost"
              size="icon"
              icon="trash"
              className="admin-btn--icon-danger"
              aria-label={`Delete ${u.name}`}
              title="Delete"
              onClick={() => setDeleting(u)}
            />
            <Button
              variant="ghost"
              size="icon"
              icon="edit"
              aria-label={`Edit ${u.name}`}
              title="Edit"
              onClick={() => router.push(`${unitsPath}/${u.id}`)}
            />
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">Organizations &gt; Period &gt; Structure</h1>
          <p className="admin-page-header__desc">
            {ORG_SUBTITLE}
            {period.status === "archived" ? " · Archived period (read-only)" : ""}
          </p>
        </div>
        <div className="admin-page-header__actions">
          {/* Period switch (Figma: cream dropdown with a calendar icon). */}
          <div className="admin-row-menu">
            {periodMenu ? (
              <div className="admin-row-menu__backdrop" onClick={() => setPeriodMenu(false)} />
            ) : null}
            <Button
              variant="outline"
              size="sm"
              icon="calendar"
              aria-haspopup="menu"
              aria-expanded={periodMenu}
              onClick={() => setPeriodMenu((open) => !open)}
            >
              Period {period.name} <Icon name="chevronDown" size={16} />
            </Button>
            {periodMenu ? (
              <div className="admin-row-menu__panel admin-org-period-menu" role="menu">
                {periods.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitem"
                    className="admin-row-menu__item"
                    onClick={() => {
                      setPeriodMenu(false);
                      router.push(`/organizations/periods/${p.id}`);
                    }}
                  >
                    Period {p.name}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="admin-fab">
            {canEdit ? (
              <Button variant="outline" size="sm" icon="plus" href={`${unitsPath}/new`}>
                Add New Unit
              </Button>
            ) : null}
          </div>
          <Button variant="outline" size="sm" icon="chevronLeft" href="/organizations">
            Back
          </Button>
        </div>
      </div>
      <OrgTabs view="period" />

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

      <OrgDeleteDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? ""}?`}
        confirmLabel="Delete Unit"
        pending={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && void remove(deleting)}
      />
      <ToastBanner message={toast.message} />
    </div>
  );
}
