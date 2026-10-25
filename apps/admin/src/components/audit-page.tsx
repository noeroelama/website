"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AUDIT_ACTIONS, type AuditAction } from "@website/audit";
import { revertAction } from "@/app/(panel)/audit/actions";
import { ActionError } from "@/components/action-error";
import { actionMessage } from "@/components/action-message";
import { downloadCsv } from "@/components/csv";
import { formatInZone, timeAgo } from "@/components/format";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SortHeader, type Column } from "@/components/ui/data-table";
import { Icon } from "@/components/ui/icon";
import { ListCard, SearchBox, Tabs, useListTable } from "@/components/ui/list-controls";
import { ToastBanner, useToastMessage } from "@/components/ui/toast";
import { AUDIT_ACTION_LABELS, label } from "@/labels";
import {
  AUDIT_PAGE_LIMIT,
  AUDIT_RANGES,
  AUDIT_TABS,
  auditCsv,
  daysLeft,
  matchesTab,
  wordDiff,
  type AuditRange,
  type AuditRow,
  type AuditTab,
  type ChangeRow,
  type FieldValue,
} from "./audit-model";
import { Select } from "@/components/ui/select";

/* ==================================================================
   Audit Log — dark list page like the Event page (tabs, search, header
   filters, pagination) with expandable rows showing Before / After.
   Times are UTC. Classes: `.admin-audit*` in globals.css.
   ================================================================== */

/** Badge colour per action (`.admin-audit-badge--*`). */
const ACTION_TONE: Record<AuditAction, string> = {
  CREATE: "created",
  UPDATE: "updated",
  DELETE: "deleted",
  PUBLISH: "created",
  UNPUBLISH: "muted",
  SEND: "updated",
  UPLOAD: "muted",
  REVERT: "reverted",
};

type SortKey = "date" | "action";

const sortValue = (r: AuditRow, key: SortKey): string =>
  key === "date" ? r.occurredAt : r.actionLabel;

/** Before / After cell of one changed field. */
function FieldCell({
  value,
  other,
  side,
}: {
  value: FieldValue;
  other: FieldValue;
  side: "before" | "after";
}) {
  if (value.kind === "empty") return <span className="admin-audit-diff__none">—</span>;
  if (value.kind === "images") {
    return (
      <span className="admin-audit-photos">
        {value.images.map((image) => (
          <span
            key={image.key}
            className={`admin-audit-photo${image.change ? ` admin-audit-photo--${image.change}` : ""}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- stored thumbnail URL */}
            <img src={image.thumbUrl} alt="" loading="lazy" />
            {image.change ? (
              <span className="admin-audit-photo__mark" aria-label={image.change}>
                {image.change === "added" ? "+" : "−"}
              </span>
            ) : null}
          </span>
        ))}
        <span className="admin-audit-diff__count">
          {value.images.length} photo{value.images.length === 1 ? "" : "s"}
        </span>
      </span>
    );
  }
  if (other.kind !== "text") return <span>{value.text}</span>;
  if (side === "before") return <del className="admin-audit-diff__old">{value.text}</del>;
  return (
    <span>
      {wordDiff(other.text, value.text).map((part, i) =>
        part.added ? (
          <ins key={i} className="admin-audit-diff__new">
            {part.text}
          </ins>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
}

/** "+2 −1" under an image field's name. */
function photoCounts(change: ChangeRow): string | null {
  if (change.after.kind !== "images" || change.before.kind !== "images") return null;
  const added = change.after.images.filter((i) => i.change === "added").length;
  const removed = change.before.images.filter((i) => i.change === "removed").length;
  return `+${added} −${removed}`;
}

/** Expanded panel: Field / Before / After, Change ID (copy) and the raw JSON. */
function ChangePanel({ row, onCopy }: { row: AuditRow; onCopy: (text: string) => void }) {
  const [raw, setRaw] = useState(false);
  return (
    <div className="admin-audit-diff">
      <div className="admin-audit-diff__grid" role="table" aria-label="Changed fields">
        <div className="admin-audit-diff__row admin-audit-diff__head" role="row">
          <span role="columnheader">Field</span>
          <span role="columnheader">
            Before{row.previousAt ? ` · ${formatInZone(row.previousAt, "UTC")}` : ""}
          </span>
          <span role="columnheader">After · {formatInZone(row.occurredAt, "UTC")}</span>
        </div>
        {row.changes.length === 0 ? (
          <div className="admin-audit-diff__row" role="row">
            <span role="cell" className="admin-audit-diff__none">
              No field changes recorded
            </span>
          </div>
        ) : null}
        {row.changes.map((change) => (
          <div key={change.field} className="admin-audit-diff__row" role="row">
            <span role="cell" className="admin-audit-diff__field">
              {change.label}
              {photoCounts(change) ? (
                <span className="admin-audit-diff__sub">{photoCounts(change)}</span>
              ) : null}
            </span>
            <span role="cell">
              <FieldCell value={change.before} other={change.after} side="before" />
            </span>
            <span role="cell">
              <FieldCell value={change.after} other={change.before} side="after" />
            </span>
          </div>
        ))}
      </div>
      <div className="admin-audit-diff__foot">
        <span className="admin-audit-diff__id">
          Change ID <code>{row.id}</code>
          <button
            type="button"
            className="admin-audit-icon-btn"
            aria-label="Copy change ID"
            onClick={() => onCopy(row.id)}
          >
            <Icon name="copy" size={14} />
          </button>
        </span>
        <button
          type="button"
          className="admin-audit-raw-btn"
          aria-expanded={raw}
          onClick={() => setRaw((v) => !v)}
        >
          <Icon name="brackets" size={14} />
          Raw JSON
        </button>
      </div>
      {raw ? <pre className="admin-audit-diff__raw">{row.raw}</pre> : null}
    </div>
  );
}

export function AuditPage({
  rows,
  range,
  truncated,
  canRevert,
  reauthUrl,
}: {
  rows: AuditRow[];
  range: AuditRange;
  /** More entries exist in the range than `AUDIT_PAGE_LIMIT`. */
  truncated: boolean;
  /** audit.revert (the server checks it again). */
  canRevert: boolean;
  reauthUrl: string | null;
}) {
  const router = useRouter();
  const toast = useToastMessage();
  const [now] = useState(() => Date.now());
  const [tab, setTab] = useState<AuditTab>("all");
  const [user, setUser] = useState("");
  const [action, setAction] = useState<AuditAction | "">("");
  const [query, setQuery] = useState(""); // applied on Search / Enter
  const [reversibleOnly, setReversibleOnly] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [confirm, setConfirm] = useState<AuditRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /* Users seen in the loaded entries (e-mail → name) for the "User" picker. */
  const users = useMemo(
    () => [...new Map(rows.map((r) => [r.author.email || r.author.name, r.author.name]))],
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        matchesTab(r, tab) &&
        (!user || (r.author.email || r.author.name) === user) &&
        (!action || r.action === action) &&
        (!reversibleOnly || r.revert.allowed) &&
        (!q || r.title.toLowerCase().includes(q)),
    );
  }, [rows, tab, user, action, reversibleOnly, query]);

  /* Newest first until a header is clicked. */
  const table = useListTable<AuditRow, SortKey>(filtered, sortValue, { key: "date", dir: "desc" });

  const counts = useMemo(
    () =>
      Object.fromEntries(
        Object.keys(AUDIT_TABS).map((t) => [
          t,
          rows.filter((r) => matchesTab(r, t as AuditTab)).length,
        ]),
      ) as Record<AuditTab, number>,
    [rows],
  );

  /* Any filter change starts again on page 1. */
  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      table.setPage(1);
    };
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text);
    toast.show("Change ID copied");
  };
  const doRevert = () =>
    start(async () => {
      if (!confirm) return;
      const result = await revertAction({ id: confirm.id });
      if (!result.ok) return setError(actionMessage(result));
      setConfirm(null);
      toast.show("Change reverted");
      router.refresh();
    });

  const columns: Column<AuditRow>[] = [
    {
      key: "expand",
      header: "",
      width: "48px",
      render: (r) => (
        <button
          type="button"
          className="admin-audit-icon-btn"
          aria-expanded={expanded.has(r.id)}
          aria-label={`${expanded.has(r.id) ? "Hide" : "Show"} changes of ${r.title}`}
          onClick={() => toggle(r.id)}
        >
          <Icon name={expanded.has(r.id) ? "chevronDown" : "chevronRight"} size={16} />
        </button>
      ),
    },
    {
      key: "date",
      header: (
        <SortHeader
          label="Date & Time"
          active={table.sort.key === "date"}
          dir={table.sort.dir}
          onClick={() => table.onSort("date")}
        />
      ),
      render: (r) => (
        <div className="admin-gallery-meta" title="UTC">
          <span className="admin-table__title">{formatInZone(r.occurredAt, "UTC")}</span>
          <span className="admin-table__sub">{timeAgo(r.occurredAt, now)}</span>
        </div>
      ),
    },
    {
      key: "user",
      header: "User",
      render: (r) => (
        <div className="admin-gallery-author">
          <span className="admin-gallery-author__avatar" aria-hidden="true">
            {r.author.initials}
          </span>
          <div>
            <div className="admin-table__title">{r.author.name}</div>
            <div className="admin-table__sub">{r.author.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: "action",
      header: (
        <SortHeader
          label="Action"
          active={table.sort.key === "action"}
          dir={table.sort.dir}
          onClick={() => table.onSort("action")}
        />
      ),
      render: (r) => (
        <div className="admin-audit-action">
          <span className="admin-audit-action__line">
            <span className={`admin-audit-badge admin-audit-badge--${ACTION_TONE[r.action]}`}>
              {r.actionLabel}
            </span>
            <span className="admin-table__sub">{r.moduleLabel}</span>
          </span>
          <span className="admin-table__title">{r.title}</span>
        </div>
      ),
    },
    {
      key: "ref",
      header: "",
      render: (r) => (
        <span className="admin-audit-ref" title={`Record ${r.resourceId}`}>
          #{r.ref}
        </span>
      ),
    },
    {
      key: "revert",
      header: "",
      align: "right",
      render: (r) =>
        r.revert.allowed ? (
          <span className="admin-audit-revert">
            <span className="admin-audit-revert__left">
              {daysLeft(r.occurredAt, now)} day{daysLeft(r.occurredAt, now) === 1 ? "" : "s"} left
            </span>
            {canRevert ? (
              <Button
                variant="outline"
                size="sm"
                icon="undo"
                onClick={() => {
                  setError(null);
                  setConfirm(r);
                }}
              >
                Revert
              </Button>
            ) : null}
          </span>
        ) : (
          <span className="admin-audit-locked" title={r.revert.reason}>
            <Icon name="lock" size={14} />
            Irreversible
          </span>
        ),
    },
  ];

  return (
    <div className="admin-audit">
      <div className="admin-page-header admin-events-header">
        <div>
          <h1 className="admin-page-header__title">Audit Log</h1>
          <p className="admin-page-header__desc">
            Tracks admin actions and reversible operations for 14 days
          </p>
        </div>
        <div className="admin-page-header__actions">
          <Button
            variant="outline"
            size="sm"
            icon="download"
            disabled={filtered.length === 0}
            onClick={() => downloadCsv("audit-log", auditCsv(filtered))}
          >
            Export CSV
          </Button>
          <label className="admin-audit-pick">
            <Icon name="calendar" size={14} />
            <Select
              aria-label="Date range"
              value={range}
              onChange={(e) => router.push(`/audit?range=${e.target.value}`)}
            >
              {Object.entries(AUDIT_RANGES).map(([key, r]) => (
                <option key={key} value={key}>
                  {r.label}
                </option>
              ))}
            </Select>
          </label>
          <label className="admin-audit-pick">
            <span>User</span>
            <Select value={user} onChange={(e) => reset(setUser)(e.target.value)}>
              <option value="">Anyone</option>
              {users.map(([key, name]) => (
                <option key={key} value={key}>
                  {name}
                </option>
              ))}
            </Select>
          </label>
          <label className="admin-audit-pick">
            <span>Action</span>
            <Select
              value={action}
              onChange={(e) => reset(setAction)(e.target.value as AuditAction | "")}
            >
              <option value="">Any</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {label(AUDIT_ACTION_LABELS, a)}
                </option>
              ))}
            </Select>
          </label>
          <SearchBox
            placeholder="Search by title..."
            label="Search entries by title"
            onSearch={reset(setQuery)}
          />
        </div>
      </div>

      <div className="admin-audit-tabbar">
        <Tabs
          label="Admin pages"
          tabs={(Object.keys(AUDIT_TABS) as AuditTab[]).map((key) => ({
            key,
            label: AUDIT_TABS[key].label,
            count: counts[key],
          }))}
          active={tab}
          onSelect={reset(setTab)}
        />
        <label className="admin-qr-switch admin-audit-switch">
          <input
            type="checkbox"
            className="admin-qr-switch__input"
            checked={reversibleOnly}
            onChange={(e) => reset(setReversibleOnly)(e.target.checked)}
          />
          <span className="admin-qr-switch__track" aria-hidden="true" />
          <span className="admin-qr-switch__label">Reversible only</span>
        </label>
      </div>

      <ListCard
        table={table}
        total={filtered.length}
        noun="entry"
        columns={columns}
        expandedRow={(r) => (expanded.has(r.id) ? <ChangePanel row={r} onCopy={copy} /> : null)}
        empty={
          <div className="admin-empty admin-empty--stack">
            <span className="admin-empty__title">No entries match</span>
            <span className="admin-empty__hint">
              Try another tab, filter or search, or a longer date range.
            </span>
          </div>
        }
      >
        {truncated ? (
          <p className="admin-audit-note">
            Only the newest {AUDIT_PAGE_LIMIT} entries of this range are listed. Choose a shorter
            date range to see older ones.
          </p>
        ) : null}
      </ListCard>

      <ConfirmDialog
        open={confirm !== null}
        title="Revert this change?"
        confirmLabel="Revert"
        icon="undo"
        pending={pending}
        onConfirm={doRevert}
        onCancel={() => setConfirm(null)}
      >
        {confirm
          ? `${confirm.changes.map((c) => c.label).join(", ") || "The record"} of “${confirm.title}” get their Before value back. A new Reverted entry is added.`
          : null}
        <ActionError text={error} reauthUrl={reauthUrl} />
      </ConfirmDialog>

      <ToastBanner message={toast.message} />
    </div>
  );
}
