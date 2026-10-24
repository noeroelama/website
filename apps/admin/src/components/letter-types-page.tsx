"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { formatNumber, NUMBER_TOKENS } from "@website/domain/documents";
import { saveLetterTypeAction } from "@/app/(panel)/letters/actions";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { type Column } from "@/components/ui/data-table";
import { FieldError } from "@/components/ui/field-error";
import { ListCard, ListEmpty, useListTable } from "@/components/ui/list-controls";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";

/* ==================================================================
   Letter types — name, code ({jenis}), number pattern, desks, whether
   the verification page shows the content to anyone. Deactivate,
   never delete: issued letters point to their type.
   ================================================================== */

export interface LetterTypeItem {
  id: string;
  version: number;
  name: string;
  code: string;
  description: string;
  numberFormat: string;
  numberPadding: number;
  requiresCoordinator: boolean;
  requiresRecipient: boolean;
  contentPublic: boolean;
  active: boolean;
  sort: number;
}

type Draft = Omit<LetterTypeItem, "id" | "version" | "numberPadding" | "sort"> & {
  numberPadding: string;
  sort: string;
};

const EMPTY: Draft = {
  name: "",
  code: "",
  description: "",
  numberFormat: "{nomor}/{jenis}/{unit}/PPIDK-ASIANIA/{bulan_romawi}/{tahun}",
  numberPadding: "3",
  requiresCoordinator: false,
  requiresRecipient: true,
  contentPublic: true,
  active: true,
  sort: "0",
};

/** "007/UND/SEKJEN/…" for the pattern being typed, or the reason it cannot number. */
function example(draft: Draft): string {
  try {
    return formatNumber(draft.numberFormat, {
      seq: 7,
      padding: Number(draft.numberPadding) || 3,
      typeCode: draft.code || "SU",
      unitCode: "SEKJEN",
      activityCode: "LKMM",
      date: new Date().toISOString().slice(0, 10),
    });
  } catch (error) {
    return (error as Error).message;
  }
}

export function LetterTypesPage(props: { initial: LetterTypeItem[]; canEdit: boolean }) {
  const pathname = usePathname();
  return <LetterTypesList key={pathname} {...props} />;
}

function LetterTypesList({
  initial: items,
  canEdit,
}: {
  initial: LetterTypeItem[];
  canEdit: boolean;
}) {
  const toast = useToastMessage();
  const router = useRouter();
  const table = useListTable(items, (t: LetterTypeItem) => t.sort);
  const [editing, setEditing] = useState<LetterTypeItem | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);

  const open = (t?: LetterTypeItem) => {
    setEditing(t ?? null);
    setFieldErrors({});
    setDraft(t ? { ...t, numberPadding: String(t.numberPadding), sort: String(t.sort) } : EMPTY);
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    const result = await saveLetterTypeAction({
      ...(editing ? { id: editing.id } : {}),
      version: editing?.version ?? null,
      ...draft,
      numberPadding: Number(draft.numberPadding),
      sort: Number(draft.sort),
    });
    setBusy(false);
    if (!result.ok) {
      setFieldErrors(result.fields ?? {});
      toast.show(actionMessage(result));
      return;
    }
    toast.show("Letter type saved");
    setDraft(null);
    router.refresh();
  };

  const errorFor = (field: string, hint?: string) => (
    <FieldError id={`type-${field}-error`} message={fieldErrors[field]} hint={hint} />
  );
  const check = (
    key: "requiresCoordinator" | "requiresRecipient" | "contentPublic" | "active",
    text: string,
  ) =>
    draft ? (
      <label className="admin-check-label">
        <input
          type="checkbox"
          checked={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })}
        />
        {text}
      </label>
    ) : null;

  const columns: Column<LetterTypeItem>[] = [
    {
      key: "name",
      header: "Type",
      width: "40%",
      render: (t) => (
        <div>
          <div className="admin-table__title">
            {t.code} — {t.name}
          </div>
          <div className="admin-table__sub">{t.numberFormat}</div>
        </div>
      ),
    },
    {
      key: "desks",
      header: "Signed by",
      width: "26%",
      render: (t) => (
        <span className="admin-table__sub">
          {t.requiresCoordinator ? "Secretary-General + Coordinator" : "Secretary-General / unit"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "20%",
      render: (t) => (
        <span className="admin-status-badge">
          {t.active ? "In use" : "Inactive"}
          {t.contentPublic ? "" : " · content gated"}
        </span>
      ),
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      width: "14%",
      render: (t) =>
        canEdit ? (
          <Button
            variant="ghost"
            size="icon"
            icon="edit"
            aria-label="Edit"
            onClick={() => open(t)}
          />
        ) : null,
    },
  ];

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Letters &gt; Letter types</h1>
          <p className="admin-page-header__desc">
            Review the pattern before the first letter of a type is issued: a printed number can
            never be corrected.
          </p>
        </div>
        <div className="admin-page-header__actions">
          <Button
            variant="outline"
            size="sm"
            icon="chevronLeft"
            onClick={() => router.push("/letters")}
          >
            Letters
          </Button>
          {canEdit ? (
            <Button variant="outline" size="sm" icon="plus" onClick={() => open()}>
              Add type
            </Button>
          ) : null}
        </div>
      </div>
      {draft ? (
        <div className="admin-dark-form">
          <div className="admin-form-grid">
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="type-name">
                Name *
              </label>
              <input
                id="type-name"
                className="admin-input"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              {errorFor("name")}
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="type-code">
                Code *
              </label>
              <input
                id="type-code"
                className="admin-input"
                maxLength={12}
                value={draft.code}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              />
              {errorFor("code", "Goes into the number as {jenis}; unique.")}
            </div>
            <div className="admin-field admin-form-grid__full">
              <label className="admin-field__label" htmlFor="type-format">
                Number pattern *
              </label>
              <input
                id="type-format"
                className="admin-input"
                value={draft.numberFormat}
                onChange={(e) => setDraft({ ...draft, numberFormat: e.target.value })}
              />
              {errorFor(
                "numberFormat",
                `Example: ${example(draft)}. Placeholders: ${NUMBER_TOKENS.map((t) => `{${t}}`).join(" ")}.`,
              )}
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="type-padding">
                Digits of {"{nomor}"}
              </label>
              <input
                id="type-padding"
                className="admin-input"
                type="number"
                min={1}
                max={6}
                value={draft.numberPadding}
                onChange={(e) => setDraft({ ...draft, numberPadding: e.target.value })}
              />
              {errorFor("numberPadding")}
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="type-sort">
                Order in lists
              </label>
              <input
                id="type-sort"
                className="admin-input"
                type="number"
                min={0}
                value={draft.sort}
                onChange={(e) => setDraft({ ...draft, sort: e.target.value })}
              />
              {errorFor("sort")}
            </div>
            <div className="admin-field admin-form-grid__full">
              <label className="admin-field__label" htmlFor="type-description">
                Description
              </label>
              <textarea
                id="type-description"
                className="admin-input admin-textarea"
                rows={2}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
              {errorFor("description")}
            </div>
            <div className="admin-field admin-form-grid__full">
              {check("requiresCoordinator", "Also signed by the Coordinator (second desk)")}
              {check("requiresRecipient", "Has a recipient")}
              {check(
                "contentPublic",
                "The verification page shows the content to anyone (off: only to who types the recipient's name)",
              )}
              {check("active", "In use")}
            </div>
          </div>
          <div className="admin-form-actions admin-form-grid__full">
            <Button variant="outline" size="sm" icon="chevronLeft" onClick={() => setDraft(null)}>
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
      ) : (
        <ListCard
          table={table}
          total={items.length}
          noun="letter type"
          columns={columns}
          empty={
            <ListEmpty
              noun="letter type"
              query=""
              filters={0}
              emptyHint="Add the first letter type."
              onClear={() => undefined}
            />
          }
        />
      )}
      <ToastBanner message={toast.message} />
    </div>
  );
}
