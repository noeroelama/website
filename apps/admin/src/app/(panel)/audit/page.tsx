import { AUDIT_ACTIONS, type AuditEvent } from "@website/audit";
import { ADMIN_PAGES, can, type AdminPageId } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import { formatUtc } from "@/components/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { AUDIT_ACTION_LABELS, label, REVERT_REJECTION_LABELS } from "@/labels";
import { requireAdminViewer, signInAgainUrl } from "@/server/context";
import { adminReads, auditLogActions } from "@/server/wiring";
import { ChangeTable, RevertButton, type Change } from "./audit-entry";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

const PAGE_SIZE = 20;
const one = (value: string | string[] | undefined) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
const day = (value: string | undefined, end: boolean) =>
  value && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`)
    : undefined;
const pageLabel = (module: string | undefined) =>
  module && Object.hasOwn(ADMIN_PAGES, module) ? ADMIN_PAGES[module as AdminPageId].label : module;

/** Field / Before / After rows; unchanged fields are not stored, so never shown. */
function changesOf(entry: AuditEvent): Change[] {
  const keys = [
    ...new Set([...Object.keys(entry.before ?? {}), ...Object.keys(entry.after ?? {})]),
  ];
  const show = (value: unknown) => (value === undefined ? "—" : JSON.stringify(value));
  return keys.sort().map((field) => ({
    field,
    before: show(entry.before?.[field]),
    after: show(entry.after?.[field]),
  }));
}

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminViewer("/audit", "audit.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  if (!can(viewer.principal, "audit.read")) return <AccessMessage reason="no-access" />;

  const params = await searchParams;
  const filters = {
    actorEmail: one(params["admin"]),
    module: one(params["module"]),
    action: AUDIT_ACTIONS.find((a) => a === one(params["action"])),
    from: day(one(params["from"]), false),
    to: day(one(params["to"]), true),
  };
  const page = await adminReads.listAudit({
    ...filters,
    cursor: one(params["cursor"]),
    limit: PAGE_SIZE,
  });
  const status = await auditLogActions().revertStatus(page.items);
  const canRevert = can(viewer.principal, "audit.revert");
  const next = new URLSearchParams(
    Object.entries({ ...params, cursor: page.nextCursor ?? undefined }).flatMap(([k, v]) =>
      typeof v === "string" ? [[k, v]] : [],
    ),
  );

  return (
    <>
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-header__title">Audit Log</h1>
          <p className="admin-page-header__desc">
            Every change made in admin, newest first. Entries cannot be edited or deleted; a revert
            adds a new entry. Times are UTC.
          </p>
        </div>
      </div>
      <form className="admin-toolbar" method="get">
        <input
          className="admin-input"
          name="admin"
          type="email"
          placeholder="Admin e-mail"
          aria-label="Admin e-mail"
          defaultValue={filters.actorEmail}
        />
        <select
          className="admin-select"
          name="module"
          aria-label="Page"
          defaultValue={filters.module ?? ""}
        >
          <option value="">All pages</option>
          {Object.entries(ADMIN_PAGES).map(([id, page]) => (
            <option key={id} value={id}>
              {page.label}
            </option>
          ))}
        </select>
        <select
          className="admin-select"
          name="action"
          aria-label="Action"
          defaultValue={filters.action ?? ""}
        >
          <option value="">All actions</option>
          {AUDIT_ACTIONS.map((action) => (
            <option key={action} value={action}>
              {label(AUDIT_ACTION_LABELS, action)}
            </option>
          ))}
        </select>
        <input
          className="admin-input"
          name="from"
          type="date"
          aria-label="From"
          defaultValue={one(params["from"])}
        />
        <input
          className="admin-input"
          name="to"
          type="date"
          aria-label="To"
          defaultValue={one(params["to"])}
        />
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      {page.items.length === 0 ? <p>No entries match these filters.</p> : null}
      {page.items.map((entry) => {
        const decision = status.get(entry.id);
        const changes = changesOf(entry);
        return (
          <Card key={entry.id}>
            <CardHeader
              title={`${entry.action} ${pageLabel(entry.module) ?? entry.resourceType} ${entry.title ?? entry.resourceId} - #${entry.id.slice(0, 8)}`}
              actions={
                canRevert ? (
                  <RevertButton
                    id={entry.id}
                    changes={changes}
                    disabledReason={
                      decision && !decision.allowed
                        ? label(REVERT_REJECTION_LABELS, decision.reason)
                        : null
                    }
                    reauthUrl={signInAgainUrl("/audit")}
                  />
                ) : null
              }
            >
              <Badge tone="primary">{entry.actor.email ?? entry.actor.id}</Badge>{" "}
              <Badge>{formatUtc(entry.occurredAt)}</Badge>
            </CardHeader>
            <CardBody flush>
              <ChangeTable changes={changes} />
            </CardBody>
          </Card>
        );
      })}
      {page.nextCursor ? (
        <p>
          <Button href={`/audit?${next.toString()}`} variant="outline">
            Load more
          </Button>
        </p>
      ) : null}
    </>
  );
}
