"use client";

import { useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  formatNumber,
  NUMBER_TOKENS,
  type Letterhead,
  type LetterheadImage,
} from "@website/domain/documents";
import { saveLetterheadAction, saveLetterTypeAction } from "@/app/(panel)/letters/actions";
import { useImageUpload } from "@/components/image-upload";
import { UploadBar } from "@/components/ui/upload-bar";
import { PhotoDrop } from "@/components/ui/photo-drop";
import { actionMessage } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { type Column } from "@/components/ui/data-table";
import { FieldError } from "@/components/ui/field-error";
import { ListCard, ListEmpty, useListTable } from "@/components/ui/list-controls";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";

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

interface Props {
  initial: LetterTypeItem[];
  letterhead: Letterhead;
  letterheadVersion: number | null;
  canEdit: boolean;
  sectionTabs: ReactNode;
}

export function LetterTypesPage(props: Props) {
  const pathname = usePathname();
  return <LetterTypesList key={pathname} {...props} />;
}

const ART: Array<{ key: "header" | "footer" | "watermark" | "emblem"; label: string }> = [
  { key: "header", label: "Letterhead image (full width)" },
  { key: "footer", label: "Footer image (full width)" },
  { key: "watermark", label: "Watermark (full page)" },
  { key: "emblem", label: "Emblem (text letterhead)" },
];

function LetterheadForm({
  initial,
  version,
  onDone,
  show,
}: {
  initial: Letterhead;
  version: number | null;
  onDone: () => void;
  show: (text: string) => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const uploads = useImageUpload("letterhead");

  const pick = async (key: (typeof ART)[number]["key"], file: File) => {
    const image = await uploads.upload(file);
    if (!image?.url) {
      show(uploads.error ?? "Upload failed. Try again.");
      return;
    }
    const art: LetterheadImage = {
      path: image.path,
      url: image.url,
      width: image.width,
      height: image.height,
    };
    setDraft((d) => ({ ...d, [key]: art }));
  };

  const save = async () => {
    setBusy(true);
    const result = await saveLetterheadAction({ letterhead: draft, version });
    setBusy(false);
    if (!result.ok) {
      setFieldErrors(result.fields ?? {});
      show(actionMessage(result));
      return;
    }
    show("Letterhead saved: it applies to letters issued from now on");
    router.refresh();
    onDone();
  };

  return (
    <form className="admin-dark-form" onSubmit={(event) => event.preventDefault()}>
      <div className="admin-form-grid">
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="kop-parent">
            Parent organisation *
          </label>
          <input
            id="kop-parent"
            className="admin-input"
            value={draft.parentName}
            onChange={(e) => setDraft({ ...draft, parentName: e.target.value })}
          />
        </div>
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="kop-main">
            Name *
          </label>
          <input
            id="kop-main"
            className="admin-input"
            value={draft.mainName}
            onChange={(e) => setDraft({ ...draft, mainName: e.target.value })}
          />
        </div>
        <div className="admin-field admin-form-grid__full">
          <label className="admin-field__label" htmlFor="kop-address">
            Address line
          </label>
          <input
            id="kop-address"
            className="admin-input"
            value={draft.address}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
          />
          <FieldError
            id="kop-letterhead-error"
            message={fieldErrors["letterhead"]}
            hint="The text letterhead is used while there is no letterhead image."
          />
        </div>
        {ART.map(({ key, label }) => (
          <div key={key} className="admin-field">
            <span className="admin-field__label">{label}</span>
            <PhotoDrop
              value={draft[key]?.url ?? null}
              label={label}
              onFile={(file) => void pick(key, file)}
              onClear={() => setDraft({ ...draft, [key]: null })}
            />
          </div>
        ))}
        <UploadBar upload={uploads} />
        <div className="admin-field">
          <label className="admin-field__label" htmlFor="kop-opacity">
            Watermark strength (%)
          </label>
          <input
            id="kop-opacity"
            className="admin-input"
            type="number"
            min={2}
            max={40}
            value={draft.watermarkOpacity}
            onChange={(e) => setDraft({ ...draft, watermarkOpacity: Number(e.target.value) })}
          />
        </div>
        <div className="admin-field">
          <label className="admin-check-label">
            <input
              type="checkbox"
              checked={draft.initialsBox}
              onChange={(e) => setDraft({ ...draft, initialsBox: e.target.checked })}
            />
            &ldquo;Paraf&rdquo; box above the footer
          </label>
        </div>
      </div>
      <div className="admin-form-actions admin-form-grid__full">
        <Button variant="outline" size="sm" icon="chevronLeft" onClick={onDone}>
          Back
        </Button>
        <div className="admin-form-actions__right">
          <Button
            type="submit"
            variant="outline"
            size="sm"
            icon="cloud"
            disabled={busy || uploads.busy}
            onClick={() => save()}
          >
            Save letterhead
          </Button>
        </div>
      </div>
    </form>
  );
}

function LetterTypesList({
  initial: items,
  letterhead,
  letterheadVersion,
  canEdit,
  sectionTabs,
}: Props) {
  const [editingLetterhead, setEditingLetterhead] = useState(false);
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
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">Letter &gt; Letter types</h1>
          <p className="admin-page-header__desc">
            Review the pattern before the first letter of a type is issued: a printed number can
            never be corrected.
          </p>
        </div>
        <div className="admin-page-header__actions">
          {canEdit ? (
            <div className="admin-fab">
              <Button
                variant="outline"
                size="sm"
                icon="image"
                onClick={() => setEditingLetterhead(true)}
              >
                Letterhead
              </Button>
              <Button variant="outline" size="sm" icon="plus" onClick={() => open()}>
                Add type
              </Button>
            </div>
          ) : null}
        </div>
      </div>
      {sectionTabs}
      {editingLetterhead ? (
        <LetterheadForm
          initial={letterhead}
          version={letterheadVersion}
          onDone={() => setEditingLetterhead(false)}
          show={toast.show}
        />
      ) : draft ? (
        <form className="admin-dark-form" onSubmit={(event) => event.preventDefault()}>
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
                type="submit"
                variant="outline"
                size="sm"
                icon="cloud"
                disabled={busy}
                onClick={() => save()}
              >
                Save
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <ListCard
          table={table}
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
