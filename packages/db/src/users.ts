import {
  isSystemRoleId,
  normalizePermissions,
  resolveAssignments,
  SYSTEM_ROLES,
  type Principal,
  type RoleAssignment,
  type RoleDefinition,
} from "@website/permissions";
import type { AuditEvent, Snapshot } from "@website/audit";
import { safeId } from "@website/security/validation";

/**
 * Accounts (`users/{uid}`) and custom roles (`roles/{id}`). Roles are data (DEC-11): built-in
 * roles come from code and always win over a stored document with the same id.
 */
export type UserStatus = "active" | "inactive";

/** Who signed in, taken from the verified session (never from request input). */
export interface SignInIdentity {
  readonly uid: string;
  readonly email: string | null;
  readonly name?: string | null | undefined;
}

/** web: records its own sign-ins (creates `users/{uid}` on the first one). */
export interface SignInRecorder {
  /** Returns the account's role ids (e.g. to log staff sign-ins as security events). */
  recordSignIn(identity: SignInIdentity, now: Date): Promise<{ roleIds: string[] }>;
}

/** admin: maps a verified uid to the account's status and resolved role assignments. */
export interface UserDirectory {
  findPrincipalByUid(uid: string): Promise<Principal | null>;
}

export interface RoleReader {
  /** Built-in roles first (code order), then stored custom roles by id. */
  list(): Promise<RoleDefinition[]>;
  get(id: string): Promise<RoleDefinition | null>;
  getMany(ids: readonly string[]): Promise<Map<string, RoleDefinition>>;
}

/** One account as the admin Users page sees it (no personal data beyond e-mail and name). */
export interface UserSummary {
  readonly uid: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly status: UserStatus;
  readonly roleAssignments: readonly RoleAssignment[];
  readonly createdAt: Date | null;
  readonly lastSignInAt: Date | null;
  readonly version: number;
}

export interface UserListQuery {
  readonly roleId?: string | undefined;
  readonly status?: UserStatus | undefined;
  /** `nextCursor` of the previous page. */
  readonly cursor?: string | undefined;
  readonly limit: number;
}

export interface Page<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

/** A custom role as stored (built-in roles are never stored). */
export interface StoredRole extends RoleDefinition {
  readonly version: number;
}

/** Audit snapshots handed to the caller's audit builder (see createGuardedAction). */
export interface AuditChange {
  readonly before: Snapshot | null;
  readonly after: Snapshot | null;
  readonly versionBefore: number | null;
  readonly versionAfter: number | null;
}

/** Builds the audit entry for a change; the store appends it in the same transaction. */
export type AuditFactory = (change: AuditChange) => AuditEvent;

/** What an account change may set; assignments are computed from the record read in the transaction. */
export interface AccountChange {
  readonly roleAssignmentsFrom?: (current: UserSummary) => readonly RoleAssignment[];
  readonly status?: UserStatus;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Keeps only well-formed stored assignments (fail closed on anything unexpected). */
export function parseAssignments(value: unknown): RoleAssignment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown): RoleAssignment[] => {
    if (!isRecord(item) || !isRecord(item["scope"])) return [];
    const roleId = item["roleId"];
    const scope = item["scope"];
    if (typeof roleId !== "string" || !safeId.safeParse(roleId).success) return [];
    if (scope["type"] === "global") return [{ roleId, scope: { type: "global" } }];
    const chapterId = scope["chapterId"];
    if (scope["type"] === "chapter" && typeof chapterId === "string") {
      return [{ roleId, scope: { type: "chapter", chapterId } }];
    }
    return [];
  });
}

/** A stored custom role, or null when it is deleted, malformed or uses a built-in id. */
export function parseCustomRole(id: string, data: unknown): RoleDefinition | null {
  if (isSystemRoleId(id) || !isRecord(data) || data["deletedAt"]) return null;
  const { name, permissions } = data;
  if (typeof name !== "string" || !Array.isArray(permissions)) return null;
  return { id, name, permissions: normalizePermissions(permissions.map(String)) };
}

export const systemRole = (id: string): RoleDefinition | null =>
  isSystemRoleId(id) ? SYSTEM_ROLES[id] : null;

/** Custom role ids an account refers to (the ones that must be read from `roles`). */
export const customRoleIds = (assignments: readonly RoleAssignment[]): string[] => [
  ...new Set(assignments.map((a) => a.roleId).filter((id) => !isSystemRoleId(id))),
];

export function toPrincipal(
  uid: string,
  data: Record<string, unknown>,
  customRoles: ReadonlyMap<string, RoleDefinition>,
): Principal {
  return {
    kind: "user",
    userId: uid,
    active: data["status"] === "active",
    assignments: resolveAssignments(parseAssignments(data["roleAssignments"]), customRoles),
  };
}

const toDate = (value: unknown): Date | null =>
  isRecord(value) && typeof value["toDate"] === "function"
    ? (value as { toDate(): Date }).toDate()
    : null;

export function toUserSummary(uid: string, data: Record<string, unknown>): UserSummary {
  return {
    uid,
    email: typeof data["email"] === "string" ? data["email"] : null,
    name: typeof data["name"] === "string" ? data["name"] : null,
    status: data["status"] === "active" ? "active" : "inactive",
    roleAssignments: parseAssignments(data["roleAssignments"]),
    createdAt: toDate(data["createdAt"]),
    lastSignInAt: toDate(data["lastSignInAt"]),
    version: typeof data["version"] === "number" ? data["version"] : 0,
  };
}

/** Role ids stored next to the assignments so lists and counts can query by role. */
export const roleIdsOf = (assignments: readonly RoleAssignment[]): string[] => [
  ...new Set(assignments.map((a) => a.roleId)),
];

/** True for an active account that holds superadmin globally. */
export const isActiveSuperadmin = (user: UserSummary): boolean =>
  user.status === "active" &&
  user.roleAssignments.some((a) => a.roleId === "superadmin" && a.scope.type === "global");

/** What an account change looks like in the audit log (roles and status only). */
export const accountSnapshot = (
  user: Pick<UserSummary, "roleAssignments" | "status">,
): Snapshot => ({
  status: user.status,
  roleAssignments: user.roleAssignments.map((a) =>
    a.scope.type === "global"
      ? { roleId: a.roleId, scope: { type: "global" } }
      : { roleId: a.roleId, scope: { type: "chapter", chapterId: a.scope.chapterId } },
  ),
});
