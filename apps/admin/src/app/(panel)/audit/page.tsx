import { can } from "@website/permissions";
import { AccessMessage } from "@/components/access-message";
import {
  AUDIT_PAGE_LIMIT,
  parseRange,
  previousChanges,
  rangeStart,
  toAuditRow,
} from "@/components/audit-model";
import { AuditPage } from "@/components/audit-page";
import { toAuthor } from "@/components/authors";
import { requireAdminViewer, signInAgainUrl } from "@/server/context";
import { adminReads, auditLogActions } from "@/server/wiring";

// Login required (blocks on the session). Signed-out visitors get a 307 from src/proxy.ts first.
export const instant = false;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireAdminViewer("/audit", "audit.read");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  if (!can(viewer.principal, "audit.read")) return <AccessMessage reason="no-access" />;

  const value = (await searchParams)["range"];
  const range = parseRange(typeof value === "string" ? value : undefined);
  const page = await adminReads.listAudit({
    from: rangeStart(range, new Date()),
    limit: AUDIT_PAGE_LIMIT,
  });
  // Names from users/{uid} in one batched read; revert decisions for the whole list in one go.
  const [users, status] = await Promise.all([
    adminReads.getUsers([...new Set(page.items.map((e) => e.actor.id))]),
    auditLogActions().revertStatus(page.items),
  ]);
  const previous = previousChanges(page.items);
  const rows = page.items.map((entry) => {
    const user = users.get(entry.actor.id);
    const author = toAuthor(user?.name ?? null, user?.email ?? entry.actor.email ?? null) ?? {
      name: entry.actor.type === "system" ? "System" : entry.actor.id,
      email: "",
      initials: entry.actor.type.slice(0, 2).toUpperCase(),
    };
    return toAuditRow(
      entry,
      author,
      status.get(entry.id) ?? { allowed: false, reason: "not_revertible" },
      previous.get(entry.id) ?? null,
    );
  });

  return (
    <AuditPage
      rows={rows}
      range={range}
      truncated={page.nextCursor !== null}
      canRevert={can(viewer.principal, "audit.revert")}
      reauthUrl={signInAgainUrl("/audit")}
    />
  );
}
