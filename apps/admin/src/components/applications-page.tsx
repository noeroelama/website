"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  applicationFileUrlAction,
  approvePlacementAction,
  failApplicationAction,
  offerApplicationAction,
  passApplicationAction,
  ratifyApplicationAction,
  rejectApplicationAction,
  requestRevisionAction,
  returnPactAction,
} from "@/app/(panel)/recruitment/actions";
import { actionMessage } from "@/components/action-message";
import { formatInZone } from "@/components/format";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SortHeader, type Column } from "@/components/ui/data-table";
import { FieldError } from "@/components/ui/field-error";
import { ListCard, ListEmpty, SearchBox, Tabs, useListTable } from "@/components/ui/list-controls";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import {
  matchesQueueTab,
  QUEUE_TABS,
  type ApplicationItem,
  type QueueTab,
} from "./applications-model";

/* ==================================================================
   Recruitment → Applications: the selection queue (C3 steps 3-6).
   Tabs per step; a row opens the application (answers, files, revision
   rounds) with the actions the viewer's permissions allow.
   ================================================================== */

type SortKey = "name" | "submitted";
const sortValue = (a: ApplicationItem, key: SortKey) =>
  key === "name" ? a.name.toLowerCase() : (a.submittedAt ?? "");

type Pending =
  | { kind: "revision" }
  | { kind: "offer" }
  | { kind: "returnPact" }
  | { kind: "ratify" }
  | { kind: "confirm"; action: "fail" | "pass" | "reject" | "approve" };

const CONFIRM = {
  fail: { title: "Fail the document check?", label: "Fail", tone: "danger" },
  pass: { title: "Pass to the interview?", label: "Pass to interview", tone: "success" },
  reject: { title: "Reject this applicant?", label: "Reject", tone: "danger" },
  approve: { title: "Approve this placement?", label: "Approve placement", tone: "success" },
} as const;

export function ApplicationsPage(props: {
  recruitment: { id: string; title: string; units: { id: string; name: string }[] };
  initial: ApplicationItem[];
  canReview: boolean;
  canOffer: boolean;
  /** recruitment.confirm (the Sekjen): approve placements and ratify. */
  canConfirm: boolean;
}) {
  const { recruitment, initial: items, canReview, canOffer, canConfirm } = props;
  const router = useRouter();
  const toast = useToastMessage();
  const [tab, setTab] = useState<QueueTab>("review");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [request, setRequest] = useState("");
  const [unit, setUnit] = useState("");
  const [seatTitle, setSeatTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (a) =>
        matchesQueueTab(a, tab) &&
        (!q || a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q)),
    );
  }, [items, tab, query]);
  const counts = useMemo(
    () =>
      Object.fromEntries(
        QUEUE_TABS.map((t) => [t.key, items.filter((a) => matchesQueueTab(a, t.key)).length]),
      ) as Record<QueueTab, number>,
    [items],
  );
  const table = useListTable(filtered, sortValue);
  const current = items.find((a) => a.id === openId) ?? null;

  const run = async (
    action: (input: unknown) => Promise<Parameters<typeof actionMessage>[0] | { ok: true }>,
    input: Record<string, unknown>,
    done: string,
  ) => {
    if (!current) return;
    setBusy(true);
    const result = await action({ id: current.id, version: current.version, ...input });
    setBusy(false);
    if (!result.ok) {
      setFieldErrors(result.fields ?? {});
      toast.show(actionMessage(result));
      return;
    }
    setPending(null);
    setFieldErrors({});
    toast.show(done);
    router.refresh();
  };

  const openFile = async (path: string) => {
    if (!current) return;
    const result = await applicationFileUrlAction({ id: current.id, path });
    if (result.ok) window.open(result.data.url, "_blank", "noopener");
    else toast.show(actionMessage(result));
  };

  const columns: Column<ApplicationItem>[] = [
    {
      key: "name",
      header: (
        <SortHeader
          label="Applicant"
          active={table.sort.key === "name"}
          dir={table.sort.dir}
          onClick={() => table.onSort("name")}
        />
      ),
      width: "30%",
      render: (a) => (
        <div>
          <div className="admin-table__title">{a.name}</div>
          <div className="admin-table__sub">{a.email}</div>
        </div>
      ),
    },
    {
      key: "choices",
      header: "Choices",
      width: "30%",
      render: (a) => (
        <span className="admin-table__sub">
          {a.choices.map((c, i) => `${i + 1}. ${c.name}`).join("  ")}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "18%",
      render: (a) => (
        <span className="admin-status-badge">
          {a.statusLabel}
          {a.offer?.expired && a.status === "offered" ? " (expired)" : ""}
        </span>
      ),
    },
    {
      key: "submitted",
      header: (
        <SortHeader
          label="Submitted (UTC)"
          active={table.sort.key === "submitted"}
          dir={table.sort.dir}
          onClick={() => table.onSort("submitted")}
        />
      ),
      width: "16%",
      render: (a) => (
        <span className="admin-table__sub">
          {a.submittedAt ? formatInZone(a.submittedAt, "UTC") : "—"}
        </span>
      ),
    },
    {
      key: "open",
      header: "",
      align: "right",
      width: "6%",
      render: (a) => (
        <Button
          variant="ghost"
          size="icon"
          icon="eye"
          aria-label="Open"
          onClick={() => setOpenId(a.id)}
        />
      ),
    },
  ];

  if (current) {
    const s = current.status;
    return (
      <div>
        <div className="admin-page-header">
          <div>
            <h1 className="admin-page-header__title">Applications &gt; {current.name}</h1>
            <p className="admin-page-header__desc">
              {recruitment.title} · {current.statusLabel}
              {current.revisionRound > 0 ? ` · revision round ${current.revisionRound}` : ""}
            </p>
          </div>
        </div>
        <div className="admin-dark-form">
          <dl className="admin-detail-list">
            <dt>E-mail</dt>
            <dd>{current.email || "—"}</dd>
            <dt>Choices</dt>
            <dd>{current.choices.map((c, i) => `${i + 1}. ${c.name}`).join(", ")}</dd>
            {current.offer ? (
              <>
                <dt>Offer</dt>
                <dd>
                  {current.offer.unitName} until {formatInZone(current.offer.expiresAt, "UTC")} UTC
                  {current.offer.expired ? " (expired)" : ""}
                </dd>
              </>
            ) : null}
            {current.portfolio ? (
              <>
                <dt>Portfolio</dt>
                <dd>
                  <Button
                    variant="outline"
                    size="sm"
                    icon="download"
                    onClick={() => void openFile(current.portfolio?.path ?? "")}
                  >
                    {current.portfolio.name}
                  </Button>
                </dd>
              </>
            ) : null}
            {current.answers.map((a) => (
              <div key={a.id} className="admin-detail-list__row">
                <dt>{a.label}</dt>
                <dd className="admin-detail-list__text">
                  {a.file ? (
                    <Button
                      variant="outline"
                      size="sm"
                      icon="download"
                      onClick={() => void openFile(a.file?.path ?? "")}
                    >
                      {a.file.name}
                    </Button>
                  ) : (
                    a.text || "—"
                  )}
                </dd>
              </div>
            ))}
            {current.pacts.length > 0 ? (
              <>
                <dt>Integrity pact</dt>
                <dd>
                  {current.pacts.map((p, i) => (
                    <Button
                      key={p.path}
                      variant="outline"
                      size="sm"
                      icon="download"
                      onClick={() => void openFile(p.path)}
                    >
                      {i === current.pacts.length - 1 ? p.name : `${p.name} (earlier)`}
                    </Button>
                  ))}
                  {current.pactNote ? ` Sent back: ${current.pactNote}` : ""}
                </dd>
              </>
            ) : null}
          </dl>
          {current.revisions.length > 0 ? (
            <div className="admin-form-separator">
              <span className="admin-field__label">Revision rounds</span>
              <ol className="admin-detail-rounds">
                {current.revisions.map((r) => (
                  <li key={r.round}>
                    <strong>Round {r.round}</strong> ({formatInZone(r.requestedAt, "UTC")} UTC):{" "}
                    {r.request}
                    {r.resubmittedAt
                      ? ` — resubmitted ${formatInZone(r.resubmittedAt, "UTC")} UTC`
                      : ""}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <div className="admin-form-actions admin-form-grid__full">
            <Button variant="outline" size="sm" icon="chevronLeft" onClick={() => setOpenId(null)}>
              Back
            </Button>
            <div className="admin-form-actions__right">
              {canReview && s === "submitted" ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    icon="undo"
                    disabled={busy}
                    onClick={() => setPending({ kind: "revision" })}
                  >
                    Request revision
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    icon="x"
                    disabled={busy}
                    onClick={() => setPending({ kind: "confirm", action: "fail" })}
                  >
                    Fail
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    icon="check"
                    disabled={busy}
                    onClick={() => setPending({ kind: "confirm", action: "pass" })}
                  >
                    Pass to interview
                  </Button>
                </>
              ) : null}
              {canOffer && (s === "interview" || s === "offered") ? (
                <Button
                  variant="outline"
                  size="sm"
                  icon="send"
                  disabled={busy}
                  onClick={() => {
                    setUnit(current.choices[0]?.id ?? recruitment.units[0]?.id ?? "");
                    setPending({ kind: "offer" });
                  }}
                >
                  {s === "offered" ? "Offer again" : "Offer a seat"}
                </Button>
              ) : null}
              {canConfirm && s === "accepted" ? (
                <Button
                  variant="outline"
                  size="sm"
                  icon="check"
                  disabled={busy}
                  onClick={() => setPending({ kind: "confirm", action: "approve" })}
                >
                  Approve placement
                </Button>
              ) : null}
              {canReview && s === "pakta_review" ? (
                <Button
                  variant="outline"
                  size="sm"
                  icon="undo"
                  disabled={busy}
                  onClick={() => setPending({ kind: "returnPact" })}
                >
                  Send pact back
                </Button>
              ) : null}
              {canConfirm && s === "pakta_review" ? (
                <Button
                  variant="outline"
                  size="sm"
                  icon="crown"
                  disabled={busy}
                  onClick={() => {
                    setSeatTitle(`Staf ${current.offer?.unitName ?? ""}`.trim());
                    setPending({ kind: "ratify" });
                  }}
                >
                  Ratify
                </Button>
              ) : null}
              {canReview && (s === "interview" || s === "offered" || s === "accepted") ? (
                <Button
                  variant="outline"
                  size="sm"
                  icon="x"
                  disabled={busy}
                  onClick={() => setPending({ kind: "confirm", action: "reject" })}
                >
                  Reject
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <Modal
          open={pending?.kind === "revision"}
          title="Request a revision"
          subtitle="The applicant sees this note, changes the application and submits it again."
          onClose={() => setPending(null)}
          footer={
            <>
              <Button
                variant="outline"
                size="sm"
                icon="chevronLeft"
                onClick={() => setPending(null)}
              >
                Back
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon="send"
                disabled={busy}
                onClick={() => void run(requestRevisionAction, { request }, "Revision requested")}
              >
                Send request
              </Button>
            </>
          }
        >
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="revision-request">
              What should change? *
            </label>
            <textarea
              id="revision-request"
              required
              className="admin-input admin-textarea"
              rows={4}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
            />
            <FieldError id="revision-request-error" message={fieldErrors["request"]} />
          </div>
        </Modal>

        <Modal
          open={pending?.kind === "offer"}
          title="Offer a seat"
          subtitle="The offer expires after the recruitment's offer days. The seat is taken when the applicant accepts."
          onClose={() => setPending(null)}
          footer={
            <>
              <Button
                variant="outline"
                size="sm"
                icon="chevronLeft"
                onClick={() => setPending(null)}
              >
                Back
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon="send"
                disabled={busy || !unit}
                onClick={() =>
                  void run(offerApplicationAction, { orgUnitId: unit }, "Seat offered")
                }
              >
                Offer
              </Button>
            </>
          }
        >
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="offer-unit">
              Unit *
            </label>
            <Select
              id="offer-unit"
              className="admin-select"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
            >
              {recruitment.units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
          </div>
        </Modal>

        <Modal
          open={pending?.kind === "returnPact"}
          title="Send the pact back"
          subtitle="The applicant sees this note and uploads the pact again; earlier files are kept."
          onClose={() => setPending(null)}
          footer={
            <>
              <Button
                variant="outline"
                size="sm"
                icon="chevronLeft"
                onClick={() => setPending(null)}
              >
                Back
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon="send"
                disabled={busy}
                onClick={() => void run(returnPactAction, { note: request }, "Pact sent back")}
              >
                Send back
              </Button>
            </>
          }
        >
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="pact-note">
              What is wrong with the pact? *
            </label>
            <textarea
              id="pact-note"
              required
              className="admin-input admin-textarea"
              rows={3}
              value={request}
              onChange={(e) => setRequest(e.target.value)}
            />
            <FieldError id="pact-note-error" message={fieldErrors["note"]} />
          </div>
        </Modal>

        <Modal
          open={pending?.kind === "ratify"}
          title="Ratify and appoint"
          subtitle={`${current.name} is confirmed and appointed to ${current.offer?.unitName ?? "the unit"} (member seat) of the active period, with the roles of that seat.`}
          onClose={() => setPending(null)}
          footer={
            <>
              <Button
                variant="outline"
                size="sm"
                icon="chevronLeft"
                onClick={() => setPending(null)}
              >
                Back
              </Button>
              <Button
                variant="outline"
                size="sm"
                icon="crown"
                disabled={busy}
                onClick={() =>
                  void run(ratifyApplicationAction, { title: seatTitle }, "Ratified and appointed")
                }
              >
                Ratify
              </Button>
            </>
          }
        >
          <div className="admin-field">
            <label className="admin-field__label" htmlFor="seat-title">
              Title of the seat *
            </label>
            <input
              id="seat-title"
              required
              minLength={2}
              className="admin-input"
              value={seatTitle}
              onChange={(e) => setSeatTitle(e.target.value)}
            />
            <FieldError id="seat-title-error" message={fieldErrors["title"]} />
          </div>
        </Modal>

        <ConfirmDialog
          open={pending?.kind === "confirm"}
          title={pending?.kind === "confirm" ? CONFIRM[pending.action].title : ""}
          confirmLabel={pending?.kind === "confirm" ? CONFIRM[pending.action].label : ""}
          tone={pending?.kind === "confirm" ? CONFIRM[pending.action].tone : "primary"}
          icon="check"
          onConfirm={() => {
            if (pending?.kind !== "confirm") return;
            const action = {
              fail: failApplicationAction,
              pass: passApplicationAction,
              reject: rejectApplicationAction,
              approve: approvePlacementAction,
            }[pending.action];
            void run(action, {}, "Saved");
          }}
          onCancel={() => setPending(null)}
        >
          {current.name}
        </ConfirmDialog>
        <ToastBanner message={toast.message} />
      </div>
    );
  }

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Recruitment &gt; Applications</h1>
          <p className="admin-page-header__desc">{recruitment.title}</p>
        </div>
        <div className="admin-page-header__actions">
          <Button
            variant="outline"
            size="sm"
            icon="chevronLeft"
            onClick={() => router.push("/recruitment")}
          >
            Back
          </Button>
          <SearchBox
            placeholder="Search by name or e-mail..."
            label="Search applications"
            onSearch={(value) => {
              setQuery(value);
              table.setPage(1);
            }}
          />
        </div>
      </div>
      <Tabs
        label="Application steps"
        tabs={QUEUE_TABS.map((t) => ({ ...t, count: counts[t.key] }))}
        active={tab}
        onSelect={(next) => {
          setTab(next);
          table.setPage(1);
        }}
      />
      <ListCard
        table={table}
        total={filtered.length}
        noun="application"
        columns={columns}
        empty={
          <ListEmpty
            noun="application"
            query={query}
            filters={0}
            emptyHint="No applications in this step."
            onClear={() => setQuery("")}
          />
        }
      />
      <ToastBanner message={toast.message} />
    </div>
  );
}
