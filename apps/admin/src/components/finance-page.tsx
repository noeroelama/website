"use client";

import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  FINANCE_CATEGORIES,
  FINANCE_CURRENCIES,
  REQUIRED_FIELDS,
  type FinanceCategory,
} from "@website/domain/finance";
import { toMinor } from "@website/domain/shared";
import {
  authorizeFinanceAction,
  completeFinanceAction,
  rejectFinanceAsCoordinatorAction,
  rejectFinanceAsTreasurerAction,
  removeFinanceAction,
  removeFinanceFileAction,
  returnFinanceAsCoordinatorAction,
  returnFinanceAsTreasurerAction,
  reviewFinanceAction,
  saveFinanceAction,
  submitFinanceAction,
} from "@/app/(panel)/finance/actions";
import { actionMessage, type ActionFailure } from "@/components/action-message";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { type Column } from "@/components/ui/data-table";
import { FieldError } from "@/components/ui/field-error";
import { ListCard, ListEmpty, SearchBox, Tabs, useListTable } from "@/components/ui/list-controls";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { FINANCE_CATEGORY_LABELS, label } from "../labels";
import {
  amountText,
  FINANCE_TABS,
  inTab,
  type FinanceItem,
  type FinanceTab,
} from "./finance-model";

/* ==================================================================
   Finance requests (I1) — draft → treasurer review → coordinator
   authorisation → paid with proof → done. Desks act only on others'
   requests; documents and the proof are private PDFs.
   ================================================================== */

interface Props {
  periodName: string | null;
  initial: FinanceItem[];
  /** Units the viewer may make requests for. */
  units: { id: string; name: string }[];
  desks: {
    edit: boolean;
    review: boolean;
    authorize: boolean;
    pay: boolean;
    /** Global finance.cashbook or finance.export: the cash book page. */
    cashbook: boolean;
  };
}

interface Draft {
  category: FinanceCategory;
  orgUnitId: string;
  title: string;
  description: string;
  amount: string;
  currency: string;
  date: string;
  account: string;
  fundSource: string;
  programId: string;
}

type Action = (input: Record<string, unknown>) => Promise<{ ok: true } | ActionFailure>;
interface NoteStep {
  title: string;
  action: Action;
  done: string;
  /** Returns and rejections must say why. */
  required: boolean;
}

const MAX_BYTES = 10 * 1024 * 1024;
const sortValue = (r: FinanceItem) => r.title;

export function FinancePage(props: Props) {
  const pathname = usePathname();
  return <FinanceList key={pathname} {...props} />;
}

function FinanceList({ periodName, initial: items, units, desks }: Props) {
  const toast = useToastMessage();
  const router = useRouter();
  const [tab, setTab] = useState<FinanceTab>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"list" | "form" | "detail">("list");
  const [current, setCurrent] = useState<FinanceItem | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [noteStep, setNoteStep] = useState<(NoteStep & { note: string }) | null>(null);
  const [paying, setPaying] = useState<{ amount: string; file: File | null } | null>(null);
  const [removing, setRemoving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (r) =>
        inTab(tab, r.status) &&
        (!q || [r.title, r.requester, r.unitName].some((v) => v.toLowerCase().includes(q))),
    );
  }, [items, tab, query]);
  const counts = useMemo(
    () =>
      Object.fromEntries(
        FINANCE_TABS.map((t) => [t.key, items.filter((r) => inTab(t.key, r.status)).length]),
      ) as Record<FinanceTab, number>,
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

  const openForm = (request?: FinanceItem) => {
    setCurrent(request ?? null);
    setFieldErrors({});
    setDraft({
      category: request?.category ?? "disbursement",
      orgUnitId: request?.orgUnitId ?? units[0]?.id ?? "",
      title: request?.title ?? "",
      description: request?.description ?? "",
      amount: request ? amountText(request.amountMinor, request.currency) : "",
      currency: request?.currency ?? "IDR",
      date: request?.date ?? "",
      account: request?.account ?? "",
      fundSource: request?.fundSource ?? "",
      programId: request?.programId ?? "",
    });
    setView("form");
  };

  const save = async () => {
    if (!draft) return;
    const amountMinor = draft.amount.trim() ? toMinor(draft.amount, draft.currency) : 0;
    if (amountMinor === null) {
      setFieldErrors({ amountMinor: "Type the amount as a number, e.g. 1500000.00." });
      return;
    }
    setBusy(true);
    const input = {
      category: draft.category,
      orgUnitId: draft.orgUnitId,
      title: draft.title,
      description: draft.description,
      currency: draft.currency,
      account: draft.account,
      fundSource: draft.fundSource,
      amountMinor,
      date: draft.date || null,
      programId: draft.programId.trim() || null,
    };
    const result = await saveFinanceAction(
      current
        ? { ...input, id: current.id, version: current.version }
        : { ...input, version: null },
    );
    setBusy(false);
    if (!result.ok) return fail(result);
    finish(current ? "Request saved" : "Draft created");
  };

  const run = async (action: Action, input: Record<string, unknown>, text: string) => {
    if (!current) return;
    setBusy(true);
    const result = await action({ id: current.id, version: current.version, ...input });
    setBusy(false);
    setNoteStep(null);
    setRemoving(false);
    if (!result.ok) return fail(result);
    finish(text);
  };

  /** Upload a document (kind=doc) or mark paid with the proof (kind=proof). */
  const upload = async (file: File, query: string, text: string) => {
    if (!current) return;
    if (file.type !== "application/pdf") return toast.show("Upload the file as a PDF.");
    if (file.size > MAX_BYTES) return toast.show("The PDF may be at most 10 MB.");
    setBusy(true);
    const response = await fetch(
      `/api/finance/${current.id}/files?version=${current.version}&${query}`,
      {
        method: "POST",
        body: file,
        headers: {
          "content-type": "application/pdf",
          "x-file-name": encodeURIComponent(file.name),
        },
      },
    );
    setBusy(false);
    setPaying(null);
    const data = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok)
      return toast.show(data.message ?? "Upload failed. Reload the page and try again.");
    finish(text);
  };

  const errorFor = (field: string, hint?: string) => (
    <FieldError id={`finance-${field}-error`} message={fieldErrors[field]} hint={hint} />
  );

  const columns: Column<FinanceItem>[] = [
    {
      key: "title",
      header: "Request",
      width: "44%",
      render: (r) => (
        <div>
          <div className="admin-table__title">{r.title}</div>
          <div className="admin-table__sub">
            {r.categoryLabel} · {r.unitName || "—"} · {r.requester}
          </div>
        </div>
      ),
    },
    { key: "amount", header: "Amount", width: "20%", render: (r) => r.amount },
    {
      key: "status",
      header: "Status",
      width: "24%",
      render: (r) => <span className="admin-status-badge">{r.statusLabel}</span>,
    },
    {
      key: "aksi",
      header: "",
      align: "right",
      width: "12%",
      render: (r) => (
        <div className="admin-table__actions">
          <Button
            variant="ghost"
            size="icon"
            icon="eye"
            aria-label="Open"
            onClick={() => {
              setCurrent(r);
              setView("detail");
            }}
          />
        </div>
      ),
    },
  ];

  if (view === "form" && draft) {
    const required = REQUIRED_FIELDS[draft.category];
    const star = (field: (typeof required)[number]) => (required.includes(field) ? " *" : "");
    const text = (
      key: Exclude<keyof Draft, "category" | "orgUnitId" | "currency">,
      labelText: string,
      extra: { type?: string; full?: boolean; hint?: string; field?: string } = {},
    ) => (
      <div className={`admin-field${extra.full ? " admin-form-grid__full" : ""}`}>
        <label className="admin-field__label" htmlFor={`finance-${key}`}>
          {labelText}
        </label>
        <input
          id={`finance-${key}`}
          className="admin-input"
          type={extra.type ?? "text"}
          value={draft[key]}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        />
        {errorFor(extra.field ?? key, extra.hint)}
      </div>
    );
    return (
      <div>
        <div className="admin-page-header">
          <div>
            <h1 className="admin-page-header__title">
              {current ? `Finance > ${current.title}` : "Finance > New request"}
            </h1>
            <p className="admin-page-header__desc">
              Fields marked * are needed before you submit. Documents are added after saving.
            </p>
          </div>
        </div>
        <div className="admin-dark-form">
          <div className="admin-form-grid">
            <label className="admin-field">
              <span className="admin-field__label">Category</span>
              <Select
                className="admin-select"
                value={draft.category}
                onChange={(e) =>
                  setDraft({ ...draft, category: e.target.value as FinanceCategory })
                }
              >
                {FINANCE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {label(FINANCE_CATEGORY_LABELS, c)}
                  </option>
                ))}
              </Select>
            </label>
            <label className="admin-field">
              <span className="admin-field__label">Unit</span>
              <Select
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
              {errorFor("orgUnitId")}
            </label>
            {text("title", `Activity / purpose${star("title")}`, { full: true })}
            {text("amount", `Amount${star("amount")}`, { field: "amountMinor" })}
            <label className="admin-field">
              <span className="admin-field__label">Currency</span>
              <Select
                className="admin-select"
                value={draft.currency}
                onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
              >
                {FINANCE_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </label>
            {text("date", `Date${star("date")}`, { type: "date" })}
            {text("account", `Destination account${star("account")}`, {
              hint: "Bank - number - account name",
            })}
            {text("fundSource", `Fund source${star("fundSource")}`)}
            {text("programId", "Work programme (optional)")}
            <div className="admin-field admin-form-grid__full">
              <label className="admin-field__label" htmlFor="finance-description">
                Description
              </label>
              <textarea
                id="finance-description"
                className="admin-input admin-textarea"
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
              {errorFor("description")}
            </div>
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

  if (view === "detail" && current) {
    const r = current;
    const editable = desks.edit && (r.status === "draft" || r.status === "revision");
    const atDesk = (desk: boolean) => desk && !r.mine;
    const fileLink = (path: string, name: string) => (
      <a
        href={`/api/finance/${r.id}/files?path=${encodeURIComponent(path)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {name}
      </a>
    );
    const ask = (step: NoteStep) => setNoteStep({ ...step, note: "" });
    return (
      <div>
        <div className="admin-page-header">
          <div>
            <h1 className="admin-page-header__title">{r.title}</h1>
            <p className="admin-page-header__desc">
              {r.categoryLabel} · {r.amount} · {r.statusLabel}
            </p>
          </div>
        </div>
        <div className="admin-dark-form">
          <dl className="admin-detail-list">
            <dt>Unit</dt>
            <dd>{r.unitName || "—"}</dd>
            <dt>Requested by</dt>
            <dd>{r.requester}</dd>
            <dt>Date</dt>
            <dd>{r.date ?? "—"}</dd>
            <dt>Destination account</dt>
            <dd>{r.account || "—"}</dd>
            <dt>Fund source</dt>
            <dd>{r.fundSource || "—"}</dd>
            {r.programId ? (
              <>
                <dt>Work programme</dt>
                <dd>{r.programId}</dd>
              </>
            ) : null}
            {r.description ? (
              <>
                <dt>Description</dt>
                <dd>{r.description}</dd>
              </>
            ) : null}
            <dt>Treasurer review</dt>
            <dd>{r.treasurer ?? "—"}</dd>
            <dt>Coordinator authorisation</dt>
            <dd>{r.coordinator ?? "—"}</dd>
            {r.revisionNote ? (
              <>
                <dt>Returned with</dt>
                <dd>{r.revisionNote}</dd>
              </>
            ) : null}
            {r.rejectionNote ? (
              <>
                <dt>Rejected because</dt>
                <dd>{r.rejectionNote}</dd>
              </>
            ) : null}
            {r.paid ? (
              <>
                <dt>Paid</dt>
                <dd>
                  {r.paid.amount} by {r.paid.by} · {fileLink(r.paid.proofPath, r.paid.proofName)}
                </dd>
              </>
            ) : null}
            <dt>Documents</dt>
            <dd>
              {r.documents.length === 0 ? (
                "None yet"
              ) : (
                <ul>
                  {r.documents.map((d) => (
                    <li key={d.path}>
                      {fileLink(d.path, d.name)}
                      {editable ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void run(removeFinanceFileAction, { path: d.path }, "Document removed")
                          }
                        >
                          Remove
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </dl>
          <div className="admin-form-actions admin-form-grid__full">
            <Button variant="outline" size="sm" icon="chevronLeft" onClick={() => setView("list")}>
              Back
            </Button>
            <div className="admin-form-actions__right">
              {editable ? (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(file, "kind=doc", "Document added");
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    icon="upload"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                  >
                    Add document (PDF)
                  </Button>
                  <Button variant="outline" size="sm" icon="edit" onClick={() => openForm(r)}>
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setRemoving(true)}
                  >
                    Delete
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void run(submitFinanceAction, {}, "Request submitted")}
                  >
                    Submit
                  </Button>
                </>
              ) : null}
              {atDesk(desks.review) && r.status === "submitted" ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      ask({
                        title: "Return to the requester",
                        action: returnFinanceAsTreasurerAction,
                        done: "Request returned",
                        required: true,
                      })
                    }
                  >
                    Return
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      ask({
                        title: "Reject the request",
                        action: rejectFinanceAsTreasurerAction,
                        done: "Request rejected",
                        required: true,
                      })
                    }
                  >
                    Reject
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() =>
                      ask({
                        title: "Review the numbers (treasurer)",
                        action: reviewFinanceAction,
                        done: "Request reviewed",
                        required: false,
                      })
                    }
                  >
                    Review
                  </Button>
                </>
              ) : null}
              {atDesk(desks.authorize) && r.status === "reviewed" ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      ask({
                        title: "Return to the requester",
                        action: returnFinanceAsCoordinatorAction,
                        done: "Request returned",
                        required: true,
                      })
                    }
                  >
                    Return
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      ask({
                        title: "Reject the request",
                        action: rejectFinanceAsCoordinatorAction,
                        done: "Request rejected",
                        required: true,
                      })
                    }
                  >
                    Reject
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() =>
                      ask({
                        title: "Authorise (coordinator)",
                        action: authorizeFinanceAction,
                        done: "Request authorised",
                        required: false,
                      })
                    }
                  >
                    Authorise
                  </Button>
                </>
              ) : null}
              {atDesk(desks.pay) && r.status === "authorized" ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() =>
                    setPaying({ amount: amountText(r.amountMinor, r.currency), file: null })
                  }
                >
                  Mark paid
                </Button>
              ) : null}
              {desks.edit && r.status === "paid" ? (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(completeFinanceAction, {}, "Request done")}
                >
                  Mark done
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        <Modal
          open={noteStep !== null}
          title={noteStep?.title ?? ""}
          onClose={() => setNoteStep(null)}
          footer={
            <Button
              variant="primary"
              size="sm"
              disabled={busy || (noteStep?.required === true && !noteStep.note.trim())}
              onClick={() =>
                noteStep && void run(noteStep.action, { note: noteStep.note }, noteStep.done)
              }
            >
              Confirm
            </Button>
          }
        >
          <label className="admin-field">
            <span className="admin-field__label">
              {noteStep?.required ? "Note (required)" : "Note (optional)"}
            </span>
            <textarea
              className="admin-input admin-textarea"
              rows={3}
              value={noteStep?.note ?? ""}
              onChange={(e) => noteStep && setNoteStep({ ...noteStep, note: e.target.value })}
            />
          </label>
        </Modal>
        <Modal
          open={paying !== null}
          title="Mark paid with the proof of transfer"
          onClose={() => setPaying(null)}
          footer={
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !paying?.file}
              onClick={() => {
                if (!paying?.file) return;
                const minor = toMinor(paying.amount, r.currency);
                if (!minor) return toast.show("Type the amount paid, more than zero.");
                void upload(paying.file, `kind=proof&amount=${minor}`, "Marked paid");
              }}
            >
              Mark paid
            </Button>
          }
        >
          {paying ? (
            <div className="admin-form-grid">
              <label className="admin-field">
                <span className="admin-field__label">Amount paid ({r.currency})</span>
                <input
                  className="admin-input"
                  value={paying.amount}
                  onChange={(e) => setPaying({ ...paying, amount: e.target.value })}
                />
              </label>
              <label className="admin-field">
                <span className="admin-field__label">Proof of transfer (PDF)</span>
                <input
                  className="admin-input"
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setPaying({ ...paying, file: e.target.files?.[0] ?? null })}
                />
              </label>
            </div>
          ) : null}
        </Modal>
        <ConfirmDialog
          open={removing}
          title="Delete this request?"
          confirmLabel="Delete"
          tone="primary"
          pending={busy}
          onConfirm={() => void run(removeFinanceAction, {}, "Request deleted")}
          onCancel={() => setRemoving(false)}
        >
          Only drafts and returned requests can be deleted.
        </ConfirmDialog>
        <ToastBanner message={toast.message} />
      </div>
    );
  }

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Finance</h1>
          <p className="admin-page-header__desc">
            {periodName
              ? `Finance requests of the ${periodName} board.`
              : "Activate a board period first (Organizations → Periods)."}
          </p>
        </div>
        <div className="admin-page-header__actions">
          <div className="admin-fab">
            {desks.cashbook ? (
              <Button variant="outline" size="sm" icon="eye" href="/finance/cashbook">
                Cash book
              </Button>
            ) : null}
            {desks.edit ? (
              <Button
                variant="outline"
                size="sm"
                icon="plus"
                disabled={!periodName || units.length === 0}
                onClick={() => openForm()}
              >
                New request
              </Button>
            ) : null}
          </div>
          <SearchBox
            placeholder="Search title, requester or unit..."
            label="Search finance requests"
            onSearch={(value) => {
              setQuery(value);
              table.setPage(1);
            }}
          />
        </div>
      </div>
      <Tabs
        label="Finance request states"
        tabs={FINANCE_TABS.map((t) => ({ ...t, count: counts[t.key] }))}
        active={tab}
        onSelect={(next) => {
          setTab(next);
          table.setPage(1);
        }}
      />
      <ListCard
        table={table}
        total={filtered.length}
        noun="request"
        columns={columns}
        empty={
          <ListEmpty
            noun="request"
            query={query}
            filters={0}
            emptyHint="No requests here."
            onClear={() => setQuery("")}
          />
        }
      />
      <ToastBanner message={toast.message} />
    </div>
  );
}
