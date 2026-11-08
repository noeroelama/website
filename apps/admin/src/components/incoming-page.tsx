"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  archiveIncomingAction,
  completeDispositionAction,
  disposeIncomingAction,
  recordIncomingAction,
  updateIncomingAction,
} from "@/app/(panel)/incoming/actions";
import { actionMessage, type ActionFailure } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { type Column } from "@/components/ui/data-table";
import { FieldError } from "@/components/ui/field-error";
import {
  ListCard,
  ListEmpty,
  SearchBox,
  SortMenu,
  StatusMenu,
  useListTable,
} from "@/components/ui/list-controls";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { INCOMING_TABS, type IncomingItem, type IncomingTab } from "./incoming-model";

interface Props {
  periodName: string | null;
  initial: IncomingItem[];
  units: { id: string; name: string }[];
  officers: { id: string; name: string }[];
  canEdit: boolean;
  canDispose: boolean;
  canManageTypes: boolean;
  sectionTabs: ReactNode;
}

interface Draft {
  sender: string;
  originNumber: string;
  subject: string;
  letterDate: string;
  receivedDate: string;
  summary: string;
}

interface DisposeDraft {
  parentId: string | null;
  target: string;
  instruction: string;
  dueDate: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const sortValue = (l: IncomingItem) => l.agendaNumber;

export function IncomingPage(props: Props) {
  const pathname = usePathname();
  return <IncomingList key={pathname} {...props} />;
}

function IncomingList({
  periodName,
  initial: items,
  units,
  officers,
  canEdit,
  canDispose,
  canManageTypes,
  sectionTabs,
}: Props) {
  const toast = useToastMessage();
  const router = useRouter();
  const [tab, setTab] = useState<IncomingTab>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "form" | "detail">("list");
  const [current, setCurrent] = useState<IncomingItem | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [disposing, setDisposing] = useState<DisposeDraft | null>(null);
  const [completing, setCompleting] = useState<{ id: string; response: string } | null>(null);
  const [archiving, setArchiving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (l) =>
        (tab === "all" || l.status === tab) &&
        (!q ||
          [l.agendaNumber, l.sender, l.subject, l.originNumber].some((v) =>
            v.toLowerCase().includes(q),
          )),
    );
  }, [items, tab, query]);
  const counts = useMemo(
    () =>
      Object.fromEntries(
        INCOMING_TABS.map((t) => [
          t.key,
          items.filter((l) => t.key === "all" || l.status === t.key).length,
        ]),
      ) as Record<IncomingTab, number>,
    [items],
  );
  const table = useListTable(filtered, sortValue);

  const fail = (result: ActionFailure) => {
    setFieldErrors(result.fields ?? {});
    toast.show(actionMessage(result));
  };
  const finish = (text: string) => {
    toast.show(text);
    router.refresh();
    setView("list");
  };

  const openForm = (letter?: IncomingItem) => {
    setCurrent(letter ?? null);
    setFieldErrors({});
    setDraft({
      sender: letter?.sender ?? "",
      originNumber: letter?.originNumber ?? "",
      subject: letter?.subject ?? "",
      letterDate: letter?.letterDate ?? "",
      receivedDate: letter?.receivedDate ?? today(),
      summary: letter?.summary ?? "",
    });
    setView("form");
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    const input = { ...draft, letterDate: draft.letterDate || null };
    const result = current
      ? await updateIncomingAction({ ...input, id: current.id, version: current.version })
      : await recordIncomingAction(input);
    setBusy(false);
    if (!result.ok) return fail(result);
    finish(current ? "Letter saved" : "Letter recorded in the agenda book");
  };

  const run = async (
    action: (input: Record<string, unknown>) => Promise<{ ok: true } | ActionFailure>,
    input: Record<string, unknown>,
    text: string,
  ) => {
    if (!current) return;
    setBusy(true);
    const result = await action({ id: current.id, version: current.version, ...input });
    setBusy(false);
    setDisposing(null);
    setCompleting(null);
    setArchiving(false);
    if (!result.ok) return fail(result);
    finish(text);
  };

  const uploadScan = async (file: File) => {
    if (!current) return;
    if (file.type !== "application/pdf") return toast.show("Upload the scan as a PDF.");
    if (file.size > 10 * 1024 * 1024) return toast.show("The scan may be at most 10 MB.");
    setBusy(true);
    const response = await fetch(`/api/incoming/${current.id}/scan?version=${current.version}`, {
      method: "POST",
      body: file,
      headers: { "content-type": "application/pdf", "x-file-name": encodeURIComponent(file.name) },
    });
    setBusy(false);
    const data = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok)
      return toast.show(data.message ?? "Upload failed. Reload the page and try again.");
    finish("Scan uploaded");
  };

  const errorFor = (field: string, hint?: string) => (
    <FieldError id={`incoming-${field}-error`} message={fieldErrors[field]} hint={hint} />
  );

  const columns: Column<IncomingItem>[] = [
    {
      key: "agenda",
      header: "Agenda",
      width: "18%",
      render: (l) => <span className="admin-table__title">{l.agendaNumber}</span>,
    },
    {
      key: "subject",
      header: "Letter",
      width: "46%",
      render: (l) => (
        <div>
          <div className="admin-table__title">{l.subject}</div>
          <div className="admin-table__sub">
            {l.sender}
            {l.originNumber ? ` · ${l.originNumber}` : ""} · received {l.receivedDate}
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "20%",
      render: (l) => <span className="admin-status-badge">{l.statusLabel}</span>,
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      width: "16%",
      render: (l) => (
        <div className="admin-table__actions">
          <Button
            variant="ghost"
            size="icon"
            icon="eye"
            aria-label="Open"
            onClick={() => {
              setCurrent(l);
              setView("detail");
            }}
          />
        </div>
      ),
    },
  ];

  if (view === "form" && draft) {
    const text = (
      key: keyof Draft,
      labelText: string,
      extra: { type?: string; full?: boolean; hint?: string } = {},
    ) => (
      <div className={`admin-field${extra.full ? " admin-form-grid__full" : ""}`}>
        <label className="admin-field__label" htmlFor={`incoming-${key}`}>
          {labelText}
        </label>
        <input
          id={`incoming-${key}`}
          className="admin-input"
          type={extra.type ?? "text"}
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        />
        {errorFor(key, extra.hint)}
      </div>
    );
    return (
      <div>
        <div className="admin-page-header">
          <div>
            <h1 className="admin-page-header__title">
              {current ? `Incoming letters > ${current.agendaNumber}` : "Incoming letters > Record"}
            </h1>
            <p className="admin-page-header__desc">
              The agenda number is given when the letter is recorded.
            </p>
          </div>
        </div>
        <form className="admin-dark-form" onSubmit={(event) => event.preventDefault()}>
          <div className="admin-form-grid">
            {text("sender", "Sender *")}
            {text("originNumber", "Sender's number")}
            {text("subject", "Subject *", { full: true })}
            {text("letterDate", "Letter date", { type: "date" })}
            {text("receivedDate", "Received on *", {
              type: "date",
              hint: "Its month and year go into the agenda number.",
            })}
            <div className="admin-field admin-form-grid__full">
              <label className="admin-field__label" htmlFor="incoming-summary">
                Summary
              </label>
              <textarea
                id="incoming-summary"
                className="admin-input admin-textarea"
                rows={3}
                value={draft.summary}
                onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
              />
              {errorFor("summary")}
            </div>
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
                {current ? "Save" : "Record"}
              </Button>
            </div>
          </div>
        </form>
        <ToastBanner message={toast.message} />
      </div>
    );
  }

  if (view === "detail" && current) {
    const archived = current.status === "archived";
    return (
      <div>
        <div className="admin-page-header">
          <div>
            <h1 className="admin-page-header__title">{current.subject}</h1>
            <p className="admin-page-header__desc">
              {current.agendaNumber} · {current.sender} · {current.statusLabel}
            </p>
          </div>
        </div>
        <div className="admin-dark-form">
          <dl className="admin-detail-list">
            <dt>Sender&apos;s number</dt>
            <dd>{current.originNumber || "—"}</dd>
            <dt>Letter date</dt>
            <dd>{current.letterDate ?? "—"}</dd>
            <dt>Received on</dt>
            <dd>{current.receivedDate}</dd>
            <dt>Recorded by</dt>
            <dd>{current.recordedBy}</dd>
            {current.summary ? (
              <>
                <dt>Summary</dt>
                <dd>{current.summary}</dd>
              </>
            ) : null}
            <dt>Scan</dt>
            <dd>
              {current.scanName ? (
                <a
                  href={`/api/incoming/${current.id}/scan`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {current.scanName}
                </a>
              ) : (
                "No scan yet"
              )}
            </dd>
          </dl>
          <div className="admin-form-separator">
            <span className="admin-field__label">Dispositions</span>
            {current.dispositions.length === 0 ? (
              <span className="admin-card__subtitle">Not disposed yet.</span>
            ) : (
              <ul className="admin-dispositions">
                {current.dispositions.map((d) => (
                  <li
                    key={d.id}
                    className="admin-dispositions__item"
                    style={{ paddingLeft: `calc(var(--space-4) * ${d.depth})` }}
                  >
                    <div className="admin-table__title">
                      {d.from} → {d.to} · {d.statusLabel}
                      {d.dueDate ? ` · due ${d.dueDate}` : ""}
                    </div>
                    <div className="admin-table__sub">{d.instruction}</div>
                    {d.response ? <div className="admin-table__sub">Done: {d.response}</div> : null}
                    {canDispose && !archived && d.status !== "done" ? (
                      <div className="admin-table__actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setDisposing({
                              parentId: d.id,
                              target: "",
                              instruction: "",
                              dueDate: "",
                            })
                          }
                        >
                          Forward
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setCompleting({ id: d.id, response: "" })}
                        >
                          Mark done
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="admin-form-actions admin-form-grid__full">
            <Button variant="outline" size="sm" icon="chevronLeft" onClick={() => setView("list")}>
              Back
            </Button>
            <div className="admin-form-actions__right">
              {canEdit && !archived ? (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadScan(file);
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    icon="upload"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                  >
                    {current.scanName ? "Replace scan" : "Upload scan (PDF)"}
                  </Button>
                  <Button variant="outline" size="sm" icon="edit" onClick={() => openForm(current)}>
                    Edit
                  </Button>
                </>
              ) : null}
              {canDispose && !archived ? (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    setDisposing({ parentId: null, target: "", instruction: "", dueDate: "" })
                  }
                >
                  Dispose
                </Button>
              ) : null}
              {canEdit && current.status === "done" ? (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={() => setArchiving(true)}
                >
                  Archive
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        <Modal
          asForm
          open={disposing !== null}
          title={disposing?.parentId ? "Forward the disposition" : "Dispose the letter"}
          onClose={() => setDisposing(null)}
          footer={
            <div className="admin-modal__footer-row">
              <Button variant="outline" icon="chevronLeft" onClick={() => setDisposing(null)}>
                Back
              </Button>
              <Button
                type="submit"
                variant="primary"
                icon="send"
                disabled={busy || !disposing?.target || !disposing.instruction.trim()}
                onClick={() => {
                  if (!disposing) return;
                  const [kind, id] = disposing.target.split(":");
                  void run(
                    disposeIncomingAction,
                    {
                      parentId: disposing.parentId,
                      toOrgUnitId: kind === "unit" ? id : null,
                      toUserId: kind === "user" ? id : null,
                      instruction: disposing.instruction,
                      dueDate: disposing.dueDate || null,
                    },
                    disposing.parentId ? "Disposition forwarded" : "Letter disposed",
                  );
                }}
              >
                Send
              </Button>
            </div>
          }
        >
          {disposing ? (
            <div className="admin-form-grid">
              <div className="admin-field admin-form-grid__full">
                <label className="admin-field__label" htmlFor="incoming-to">
                  To
                </label>
                <Select
                  id="incoming-to"
                  className="admin-select"
                  value={disposing.target}
                  onChange={(e) => setDisposing({ ...disposing, target: e.target.value })}
                >
                  <option value="">Choose a unit or an officer</option>
                  <optgroup label="Units">
                    {units.map((u) => (
                      <option key={u.id} value={`unit:${u.id}`}>
                        {u.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Officers">
                    {officers.map((o) => (
                      <option key={o.id} value={`user:${o.id}`}>
                        {o.name}
                      </option>
                    ))}
                  </optgroup>
                </Select>
              </div>
              <div className="admin-field admin-form-grid__full">
                <label className="admin-field__label" htmlFor="incoming-instruction">
                  Instruction
                </label>
                <textarea
                  id="incoming-instruction"
                  className="admin-input admin-textarea"
                  rows={3}
                  value={disposing.instruction}
                  onChange={(e) => setDisposing({ ...disposing, instruction: e.target.value })}
                />
              </div>
              <div className="admin-field">
                <label className="admin-field__label" htmlFor="incoming-due-date">
                  Due date
                </label>
                <input
                  id="incoming-due-date"
                  className="admin-input"
                  type="date"
                  min={today()}
                  value={disposing.dueDate}
                  onChange={(e) => setDisposing({ ...disposing, dueDate: e.target.value })}
                />
              </div>
            </div>
          ) : null}
        </Modal>
        <Modal
          asForm
          open={completing !== null}
          title="Mark the disposition done"
          onClose={() => setCompleting(null)}
          footer={
            <div className="admin-modal__footer-row">
              <Button variant="outline" icon="chevronLeft" onClick={() => setCompleting(null)}>
                Back
              </Button>
              <Button
                type="submit"
                variant="primary"
                icon="check"
                disabled={busy}
                onClick={() =>
                  completing &&
                  void run(
                    completeDispositionAction,
                    { dispositionId: completing.id, response: completing.response },
                    "Disposition done",
                  )
                }
              >
                Mark done
              </Button>
            </div>
          }
        >
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="incoming-response">
              What was done (optional)
            </label>
            <textarea
              id="incoming-response"
              className="admin-input admin-textarea"
              rows={3}
              value={completing?.response ?? ""}
              onChange={(e) =>
                completing && setCompleting({ ...completing, response: e.target.value })
              }
            />
          </div>
        </Modal>
        <ConfirmDialog
          open={archiving}
          title="Archive this letter?"
          confirmLabel="Archive"
          tone="primary"
          pending={busy}
          onConfirm={() => void run(archiveIncomingAction, {}, "Letter archived")}
          onCancel={() => setArchiving(false)}
        >
          An archived letter cannot be edited or disposed again.
        </ConfirmDialog>
        <ToastBanner message={toast.message} />
      </div>
    );
  }

  return (
    <div>
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">Letter &gt; Incoming</h1>
          <p className="admin-page-header__desc">
            {periodName
              ? `Agenda book of the ${periodName} board.`
              : "Activate a board period first (Organizations → Periods)."}
          </p>
        </div>
        <div className="admin-page-header__actions">
          <div className="admin-fab">
            {canManageTypes ? (
              <Button
                variant="outline"
                size="sm"
                icon="settings"
                onClick={() => router.push("/letters?tab=types")}
              >
                Letter types
              </Button>
            ) : null}
            {canEdit ? (
              <Button
                variant="outline"
                size="sm"
                icon="plus"
                disabled={!periodName}
                onClick={() => openForm()}
              >
                Send Mail
              </Button>
            ) : null}
          </div>
          <StatusMenu
            options={INCOMING_TABS.map((t) => ({
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
            placeholder="Search agenda, sender or subject..."
            label="Search incoming letters"
            onSearch={(value) => {
              setQuery(value);
              table.setPage(1);
            }}
          />
        </div>
      </div>
      {sectionTabs}
      <ListCard
        table={table}
        noun="letter"
        columns={columns}
        empty={
          <ListEmpty
            noun="letter"
            query={query}
            filters={0}
            emptyHint="No letters here."
            onClear={() => setQuery("")}
          />
        }
      />
      <ToastBanner message={toast.message} />
    </div>
  );
}
