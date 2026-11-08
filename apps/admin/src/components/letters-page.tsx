"use client";

import { useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  cancelLetterAction,
  issueLetterAction,
  issueLetterFileAction,
  passLetterAction,
  removeLetterAction,
  returnLetterAction,
  saveLetterAction,
  signLetterAction,
  signLetterAsCoordinatorAction,
  submitLetterAction,
} from "@/app/(panel)/letters/actions";
import { actionMessage, type ActionFailure } from "@/components/action-message";
import { formatInZone } from "@/components/format";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, DELETE_HINT } from "@/components/ui/confirm-dialog";
import type { Column } from "@/components/ui/data-table";
import { FieldError } from "@/components/ui/field-error";
import {
  ListCard,
  ListEmpty,
  MenuItem,
  RowMenu,
  SearchBox,
  Tabs,
  useListTable,
  SortMenu,
  StatusMenu,
} from "@/components/ui/list-controls";
import { Modal } from "@/components/ui/modal";
import {
  joinBlocks,
  splitBlocks,
  RichTextStack,
  type RichTextBlock,
} from "@/components/ui/rich-text-box";
import { Select } from "@/components/ui/select";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { LetterUploadPanel } from "./letter-upload-panel";
import {
  LETTER_TABS,
  letterActions,
  matchesLetterTab,
  type LetterActionKey,
  type LetterDesks,
  type LetterItem,
  type LetterTab,
} from "./letters-model";

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

type SortKey = "subject" | "created";
const sortValue = (l: LetterItem, key: SortKey) =>
  key === "subject" ? l.subject.toLowerCase() : l.createdAt;
const filterText = (l: LetterItem, key: SortKey): string =>
  key === "subject" ? l.subject : formatInZone(l.createdAt, browserZone(), false);

interface TypeOption {
  id: string;
  name: string;
  code: string;
  requiresRecipient: boolean;
  requiresCoordinator: boolean;
}

interface Draft {
  source: "editor" | "upload" | "certificate";
  activityCode: string;
  typeId: string;
  orgUnitId: string;
  subject: string;
  recipient: string;
  place: string;
  attachmentNote: string;
  letterDate: string;
  bodies: RichTextBlock[];
}

interface Props {
  periodName: string | null;
  truncated: boolean;
  initial: LetterItem[];
  types: TypeOption[];
  units: { id: string; name: string }[];
  viewerId: string;
  desks: LetterDesks;
  canWrite: boolean;
  canManageTypes: boolean;
  sectionTabs: ReactNode;
}

const today = () => new Date().toISOString().slice(0, 10);

const ACTION_LABELS: Record<Exclude<LetterActionKey, "edit" | "delete">, string> = {
  submit: "Submit for review",
  pass: "Pass correction",
  return: "Return to draft",
  signSecretary: "Sign (Secretary-General)",
  signCoordinator: "Sign (Coordinator)",
  issue: "Issue and number",
  issueFile: "Issue the stamped PDF",
  cancel: "Cancel letter",
};

export type LetterSection = "outgoing" | "incoming" | "types";

export function LetterSectionTabs({
  sections,
  active,
}: {
  sections: readonly { key: LetterSection; label: string }[];
  active: LetterSection;
}) {
  const router = useRouter();
  return (
    <Tabs
      label="Letter sections"
      tabs={sections}
      active={active}
      onSelect={(key) => router.push(key === "outgoing" ? "/letters" : `/letters?tab=${key}`)}
    />
  );
}

export function LettersPage(props: Props) {
  const pathname = usePathname();
  return <LettersList key={pathname} {...props} />;
}

function LettersList(props: Props) {
  const { initial: items, types, units, viewerId, desks, canWrite, periodName } = props;
  const toast = useToastMessage();
  const router = useRouter();
  const [tab, setTab] = useState<LetterTab>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "form" | "detail">("list");
  const [current, setCurrent] = useState<LetterItem | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<
    "return" | "cancel" | "issue" | "issueFile" | "delete" | null
  >(null);
  const [note, setNote] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (l) =>
        matchesLetterTab(l, tab) &&
        (!q ||
          l.subject.toLowerCase().includes(q) ||
          (l.numberFormatted ?? "").toLowerCase().includes(q) ||
          l.recipient.toLowerCase().includes(q)),
    );
  }, [items, tab, query]);
  const counts = useMemo(
    () =>
      Object.fromEntries(
        LETTER_TABS.map((t) => [t.key, items.filter((l) => matchesLetterTab(l, t.key)).length]),
      ) as Record<LetterTab, number>,
    [items],
  );
  const table = useListTable(filtered, sortValue, undefined, filterText);
  const typeOf = (id: string) => types.find((t) => t.id === id);

  const fail = (result: ActionFailure) => {
    setFieldErrors(result.fields ?? {});
    toast.show(actionMessage(result));
  };

  const openForm = (letter?: LetterItem) => {
    setCurrent(letter ?? null);
    setFieldErrors({});
    setDraft({
      source: letter?.source ?? "editor",
      activityCode: letter?.activityCode ?? "",
      typeId: letter?.typeId ?? types[0]?.id ?? "",
      orgUnitId: letter?.orgUnitId ?? units[0]?.id ?? "",
      subject: letter?.subject ?? "",
      recipient: letter?.recipient ?? "",
      place: letter?.place ?? "",
      attachmentNote: letter?.attachmentNote ?? "",
      letterDate: letter?.letterDate ?? today(),
      bodies: splitBlocks(letter?.body ?? ""),
    });
    setView("form");
  };

  const openDetail = (letter: LetterItem) => {
    setCurrent(letter);
    setView("detail");
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    const result = await saveLetterAction({
      ...(current ? { id: current.id } : { source: draft.source }),
      version: current?.version ?? null,
      typeId: draft.typeId,
      orgUnitId: draft.orgUnitId,
      subject: draft.subject,
      body: joinBlocks(draft.bodies),
      recipient: draft.recipient,
      place: draft.place,
      attachmentNote: draft.attachmentNote,
      letterDate: draft.letterDate || null,
      activityCode: draft.activityCode.trim() || null,
    });
    setBusy(false);
    if (!result.ok) {
      fail(result);
      return;
    }
    toast.show("Letter saved");
    router.refresh();
    setView("list");
  };

  const act = async (
    run: (input: Record<string, unknown>) => Promise<{ ok: true } | ActionFailure>,
    done: string,
    extra: Record<string, unknown> = {},
  ) => {
    if (!current) return;
    setBusy(true);
    const result = await run({ id: current.id, version: current.version, ...extra });
    setBusy(false);
    setAsking(null);
    setNote("");
    if (!result.ok) {
      fail(result);
      return;
    }
    toast.show(done);
    router.refresh();
    setView("list");
  };

  const runAction = (key: LetterActionKey) => {
    switch (key) {
      case "edit":
        return openForm(current ?? undefined);
      case "submit":
        return void act(submitLetterAction, "Submitted for review");
      case "pass":
        return void act(passLetterAction, "Correction passed: ready to sign");
      case "signSecretary":
        return void act(signLetterAction, "Signed");
      case "signCoordinator":
        return void act(signLetterAsCoordinatorAction, "Signed as Coordinator");
      case "return":
      case "cancel":
      case "issue":
      case "issueFile":
      case "delete":
        return setAsking(key);
    }
  };

  const errorFor = (field: string, hint?: string) => (
    <FieldError id={`letter-${field}-error`} message={fieldErrors[field]} hint={hint} />
  );

  const columns: Column<LetterItem>[] = [
    {
      key: "subject",
      header: table.header("subject", "Letter"),
      width: "40%",
      render: (l) => (
        <div>
          <div className="admin-table__title">{l.subject}</div>
          <div className="admin-table__sub">
            {l.numberFormatted ?? `${l.typeName} · draft by ${l.authorName}`}
          </div>
        </div>
      ),
    },
    {
      key: "unit",
      header: "Unit",
      width: "20%",
      render: (l) => <span className="admin-table__sub">{l.unitName}</span>,
    },
    {
      key: "created",
      header: table.header("created", "Created"),
      width: "18%",
      render: (l) => (
        <span className="admin-table__sub">{formatInZone(l.createdAt, browserZone())}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "14%",
      render: (l) => <span className="admin-status-badge">{l.statusLabel}</span>,
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      width: "8%",
      render: (l) => (
        <div className="admin-table__actions">
          <Button
            variant="ghost"
            size="icon"
            icon="eye"
            aria-label="Open"
            onClick={() => openDetail(l)}
          />
          {l.canEdit && (l.status === "draft" || l.status === "review") ? (
            <RowMenu>
              <MenuItem icon="edit" onClick={() => openForm(l)}>
                Edit
              </MenuItem>
            </RowMenu>
          ) : null}
        </div>
      ),
    },
  ];

  if (view === "form" && draft) {
    const type = typeOf(draft.typeId);
    return (
      <div>
        <div className="admin-page-header">
          <div>
            <h1 className="admin-page-header__title">
              {current ? "Letters > Edit" : "Letters > Write"}
            </h1>
            <p className="admin-page-header__desc">
              The number is given only after the secretariat&apos;s correction and the signing
              desks: when the letter is issued, or (own PDF) when the number is taken.
            </p>
          </div>
        </div>
        <form className="admin-dark-form" onSubmit={(event) => event.preventDefault()}>
          {current?.reviewNote ? (
            <p className="admin-card__subtitle">Returned with: {current.reviewNote}</p>
          ) : null}
          <div className="admin-form-grid">
            {current ? null : (
              <div className="admin-field admin-form-grid__full">
                <label className="admin-field__label" htmlFor="letter-source">
                  Document
                </label>
                <Select
                  id="letter-source"
                  className="admin-select"
                  value={draft.source}
                  onChange={(e) =>
                    setDraft({ ...draft, source: e.target.value as Draft["source"] })
                  }
                >
                  <option value="editor">Write the letter here</option>
                  <option value="certificate">
                    Certificate batch (one number, a sheet per participant)
                  </option>
                  <option value="upload">
                    Own PDF (SOP, decree with annexes: upload after numbering)
                  </option>
                </Select>
              </div>
            )}
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="letter-type">
                Letter type *
              </label>
              <Select
                id="letter-type"
                className="admin-select"
                value={draft.typeId}
                onChange={(e) => setDraft({ ...draft, typeId: e.target.value })}
              >
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} — {t.name}
                  </option>
                ))}
              </Select>
              {errorFor(
                "typeId",
                type?.requiresCoordinator
                  ? "Signed by the Secretary-General and the Coordinator."
                  : undefined,
              )}
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="letter-unit">
                Issuing unit *
              </label>
              <Select
                id="letter-unit"
                className="admin-select"
                value={draft.orgUnitId}
                onChange={(e) => setDraft({ ...draft, orgUnitId: e.target.value })}
              >
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
              {errorFor("orgUnitId", "Its code goes into the number ({unit}).")}
            </div>
            <div className="admin-field admin-form-grid__full">
              <label className="admin-field__label" htmlFor="letter-subject">
                Subject *
              </label>
              <input
                id="letter-subject"
                className="admin-input"
                maxLength={200}
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
              />
              {errorFor("subject")}
            </div>
            {type?.requiresRecipient !== false ? (
              <div className="admin-field">
                <label className="admin-field__label" htmlFor="letter-recipient">
                  Recipient *
                </label>
                <input
                  id="letter-recipient"
                  className="admin-input"
                  maxLength={160}
                  value={draft.recipient}
                  onChange={(e) => setDraft({ ...draft, recipient: e.target.value })}
                />
                {errorFor("recipient")}
              </div>
            ) : null}
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="letter-date">
                Letter date *
              </label>
              <input
                id="letter-date"
                className="admin-input"
                type="date"
                value={draft.letterDate}
                onChange={(e) => setDraft({ ...draft, letterDate: e.target.value })}
              />
              {errorFor("letterDate", "Its month and year go into the number.")}
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="letter-place">
                Place of signing
              </label>
              <input
                id="letter-place"
                className="admin-input"
                maxLength={80}
                value={draft.place}
                onChange={(e) => setDraft({ ...draft, place: e.target.value })}
              />
              {errorFor("place")}
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="letter-attachment">
                Attachment
              </label>
              <input
                id="letter-attachment"
                className="admin-input"
                maxLength={120}
                placeholder="-"
                value={draft.attachmentNote}
                onChange={(e) => setDraft({ ...draft, attachmentNote: e.target.value })}
              />
              {errorFor("attachmentNote")}
            </div>
            <div className="admin-field">
              <label className="admin-field__label" htmlFor="letter-activity">
                Activity code{draft.source === "certificate" ? " *" : ""}
              </label>
              <input
                id="letter-activity"
                className="admin-input"
                maxLength={24}
                placeholder="LKMM"
                value={draft.activityCode}
                onChange={(e) => setDraft({ ...draft, activityCode: e.target.value })}
              />
              {errorFor("activityCode", "Goes into the number when the type uses {kode_kegiatan}.")}
            </div>
            {draft.source === "upload" ? null : (
              <div className="admin-field admin-form-grid__full">
                <span className="admin-field__label">
                  {draft.source === "certificate"
                    ? "Citation under the name (empty: “atas partisipasinya dalam kegiatan …”)"
                    : "Body *"}
                </span>
                <RichTextStack
                  blocks={draft.bodies}
                  onChange={(bodies) => setDraft({ ...draft, bodies })}
                  uploadImage={() => {
                    toast.show("Images are not printed on letters: use the upload path for those.");
                    return Promise.resolve(null);
                  }}
                  label="Letter body"
                />
                {errorFor("body")}
              </div>
            )}
          </div>
          <div className="admin-form-actions admin-form-grid__full">
            <Button variant="outline" size="sm" icon="chevronLeft" onClick={() => setView("list")}>
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
                Save draft
              </Button>
            </div>
          </div>
        </form>
        <ToastBanner message={toast.message} />
      </div>
    );
  }

  if (view === "detail" && current) {
    const actions = letterActions(current, desks, viewerId);
    const zone = browserZone();
    return (
      <div>
        <div className="admin-page-header">
          <div>
            <h1 className="admin-page-header__title">{current.subject}</h1>
            <p className="admin-page-header__desc">
              {current.numberFormatted ?? current.typeName} · {current.statusLabel}
            </p>
          </div>
        </div>
        <div className="admin-dark-form">
          <dl className="admin-detail-list">
            <dt>Type</dt>
            <dd>
              {current.typeCode} — {current.typeName}
            </dd>
            <dt>Unit</dt>
            <dd>{current.unitName}</dd>
            {current.recipient ? (
              <>
                <dt>Recipient</dt>
                <dd>{current.recipient}</dd>
              </>
            ) : null}
            <dt>Date</dt>
            <dd>
              {current.letterDate ?? "—"}
              {current.place ? `, ${current.place}` : ""}
            </dd>
            <dt>Written by</dt>
            <dd>{current.authorName}</dd>
            <dt>Secretary-General</dt>
            <dd>
              {current.secretary
                ? `${current.secretary.name}, ${formatInZone(current.secretary.at, zone)}`
                : "Not signed"}
            </dd>
            {current.requiresCoordinator ? (
              <>
                <dt>Coordinator</dt>
                <dd>
                  {current.coordinator
                    ? `${current.coordinator.name}, ${formatInZone(current.coordinator.at, zone)}`
                    : "Not signed"}
                </dd>
              </>
            ) : null}
            {current.verificationCode ? (
              <>
                <dt>Verification code</dt>
                <dd>{current.verificationCode}</dd>
              </>
            ) : null}
            {current.reviewNote ? (
              <>
                <dt>Review note</dt>
                <dd>{current.reviewNote}</dd>
              </>
            ) : null}
            {current.cancelReason ? (
              <>
                <dt>Cancelled because</dt>
                <dd>{current.cancelReason}</dd>
              </>
            ) : null}
          </dl>
          {current.source === "upload" ? null : (
            <div className="admin-letter-body" dangerouslySetInnerHTML={{ __html: current.body }} />
          )}
          {current.source === "upload" && current.status === "awaiting_file" ? (
            <LetterUploadPanel
              letter={current}
              onDone={(message) => {
                toast.show(message);
                router.refresh();
                setView("list");
              }}
              onError={(message) => toast.show(message)}
            />
          ) : null}
          <div className="admin-form-actions admin-form-grid__full">
            <Button variant="outline" size="sm" icon="chevronLeft" onClick={() => setView("list")}>
              Back
            </Button>
            <div className="admin-form-actions__right">
              {current.source === "certificate" ? (
                <Button
                  variant="outline"
                  size="sm"
                  icon="users"
                  onClick={() => router.push(`/letters/${current.id}/participants`)}
                >
                  Participants
                </Button>
              ) : null}
              {(current.source === "upload" && !current.upload) ||
              current.source === "certificate" ? null : (
                <Button
                  variant="outline"
                  size="sm"
                  icon="download"
                  onClick={() =>
                    window.open(`/api/letters/${current.id}/pdf`, "_blank", "noopener")
                  }
                >
                  {current.status === "issued" ? "PDF (archive)" : "Preview PDF"}
                </Button>
              )}
              {actions.map((key) =>
                key === "edit" ? (
                  <Button
                    key={key}
                    variant="outline"
                    size="sm"
                    icon="edit"
                    onClick={() => runAction(key)}
                  >
                    Edit
                  </Button>
                ) : key === "delete" ? (
                  <Button
                    key={key}
                    variant="outline"
                    size="sm"
                    icon="trash"
                    onClick={() => runAction(key)}
                  >
                    Delete draft
                  </Button>
                ) : (
                  <Button
                    key={key}
                    variant="primary"
                    size="sm"
                    disabled={busy}
                    onClick={() => runAction(key)}
                  >
                    {key === "issue" && current.source === "upload"
                      ? "Take number"
                      : ACTION_LABELS[key]}
                  </Button>
                ),
              )}
            </div>
          </div>
        </div>
        <Modal
          asForm
          open={asking === "return" || asking === "cancel"}
          title={asking === "return" ? "Return to draft" : "Cancel this letter?"}
          onClose={() => setAsking(null)}
          footer={
            <div className="admin-modal__footer-row">
              <Button variant="outline" icon="chevronLeft" onClick={() => setAsking(null)}>
                Back
              </Button>
              <Button
                type="submit"
                variant="primary"
                icon="check"
                disabled={busy || !note.trim()}
                onClick={() =>
                  void (asking === "return"
                    ? act(returnLetterAction, "Returned to draft", { note })
                    : act(cancelLetterAction, "Letter cancelled", { reason: note }))
                }
              >
                {asking === "return" ? "Return" : "Cancel letter"}
              </Button>
            </div>
          }
        >
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="letter-note">
              {asking === "return"
                ? "What must be fixed? (both signatures are cleared)"
                : "Reason (shown on the public verification page; the number is never reused)"}
            </label>
            <textarea
              id="letter-note"
              className="admin-input admin-textarea"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </Modal>
        <ConfirmDialog
          open={asking === "issue"}
          title={current.source === "upload" ? "Take the number?" : "Issue this letter?"}
          confirmLabel={current.source === "upload" ? "Take number" : "Issue"}
          tone="primary"
          pending={busy}
          onConfirm={() =>
            void act(
              issueLetterAction,
              current.source === "upload" ? "Number taken: upload the final PDF" : "Letter issued",
            )
          }
          onCancel={() => setAsking(null)}
        >
          It gets the next number and a verification code. A number is never taken back: a wrong
          letter can only be cancelled.
        </ConfirmDialog>
        <ConfirmDialog
          open={asking === "issueFile"}
          title="Issue the stamped PDF?"
          confirmLabel="Issue"
          tone="primary"
          pending={busy}
          onConfirm={() => void act(issueLetterFileAction, "Letter issued")}
          onCancel={() => setAsking(null)}
        >
          The PDF as the preview shows it (with the signatures and the QR) is kept byte for byte as
          the letter&apos;s archive. Check the preview first.
        </ConfirmDialog>
        <ConfirmDialog
          open={asking === "delete"}
          title="Delete this draft?"
          pending={busy}
          onConfirm={() => void act(removeLetterAction, "Draft deleted")}
          onCancel={() => setAsking(null)}
        >
          {DELETE_HINT}
        </ConfirmDialog>
        <ToastBanner message={toast.message} />
      </div>
    );
  }

  return (
    <div>
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">Letter &gt; Outgoing</h1>
          <p className="admin-page-header__desc">
            {periodName
              ? `Outgoing letters of the ${periodName} board${props.truncated ? " (newest 300 shown)" : ""}.`
              : "Activate a board period first (Organizations → Periods)."}
          </p>
        </div>
        <div className="admin-page-header__actions">
          <div className="admin-fab">
            {props.canManageTypes ? (
              <Button
                variant="outline"
                size="sm"
                icon="settings"
                onClick={() => router.push("/letters?tab=types")}
              >
                Letter types
              </Button>
            ) : null}
            {canWrite ? (
              <Button
                variant="outline"
                size="sm"
                icon="plus"
                disabled={!periodName || types.length === 0 || units.length === 0}
                title={types.length === 0 ? "Add a letter type first" : undefined}
                onClick={() => openForm()}
              >
                Write letter
              </Button>
            ) : null}
          </div>
          <StatusMenu
            options={LETTER_TABS.map((t) => ({
              key: t.key,
              label: `${t.label} (${counts[t.key]})`,
            }))}
            value={tab}
            onSelect={(key) => {
              setTab(key);
              table.setPage(1);
            }}
          />
          <SortMenu columns={columns} />
          <SearchBox
            placeholder="Search subject, number or recipient..."
            label="Search letters"
            onSearch={(value) => {
              setQuery(value);
              table.setPage(1);
            }}
          />
        </div>
      </div>
      {props.sectionTabs}
      <ListCard
        table={table}
        noun="letter"
        columns={columns}
        empty={
          <ListEmpty
            noun="letter"
            query={query}
            filters={0}
            emptyHint="No letters at this desk."
            onClear={() => setQuery("")}
          />
        }
      />
      <ToastBanner message={toast.message} />
    </div>
  );
}
