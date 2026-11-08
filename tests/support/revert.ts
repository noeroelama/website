import { createSqlAuditStore } from "@website/db/sql";
import { normalizePermissions, type Principal } from "@website/permissions";
import {
  createAuditLogActions,
  REVERTIBLE_COLLECTIONS,
} from "../../apps/admin/src/server/audit-log";

type Db = Parameters<typeof createSqlAuditStore>[0];

const auditor: Principal = {
  kind: "user",
  userId: "auditor-1",
  active: true,
  assignments: [
    {
      roleId: "r",
      scope: { type: "global" },
      permissions: new Set(normalizePermissions(["audit.read", "audit.revert"])),
    },
  ],
};

export function revertEntry(db: unknown, id: string, now: Date) {
  return createAuditLogActions({
    audit: createSqlAuditStore(db as Db),
    revertible: REVERTIBLE_COLLECTIONS,
    now: () => now,
    logSecurityEvent: () => undefined,
  }).revert(
    () => Promise.resolve(auditor),
    () =>
      Promise.resolve({
        actorEmail: "auditor@example.org",
        requestId: "req-777777",
        authTime: Date.now() / 1000,
      }),
  )({ id });
}
