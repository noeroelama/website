import {
  DEFAULT_ROLE_ASSIGNMENTS,
  DEFAULT_ROLE_COLOR,
  isRoleColor,
  isSystemRoleId,
  normalizePermissions,
  resolveAssignments,
  SYSTEM_ROLES,
  type AccountStatus,
  type Principal,
  type RoleAssignment,
  type RoleColor,
  type RoleDefinition,
  type Scope,
} from "@website/permissions";
import type { AuditEvent, Snapshot } from "@website/audit";
import { safeId } from "@website/security/validation";

export type UserStatus = AccountStatus;

export interface SignInIdentity {
  readonly uid: string;
  readonly email: string | null;
  readonly name?: string | null | undefined;
  readonly emailVerified?: boolean | undefined;
}

export interface SignInRecorder {
  recordSignIn(
    identity: SignInIdentity,
    now: Date,
    twoSignInMethods?: () => Promise<boolean>,
  ): Promise<{ roleIds: string[] }>;
}

export interface Invite {
  readonly email: string;
  readonly roleIds: readonly string[];
  readonly status: "pending" | "accepted" | "cancelled";
  readonly invitedBy: string;
  readonly createdAt: Date | null;
  readonly version: number;
}

export interface UserDirectory {
  findPrincipalByUid(uid: string): Promise<Principal | null>;
}

export interface RoleReader {
  list(): Promise<RoleDefinition[]>;
  get(id: string): Promise<RoleDefinition | null>;
  getMany(ids: readonly string[]): Promise<Map<string, RoleDefinition>>;
}

export interface UserSummary {
  readonly uid: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly status: UserStatus;
  readonly chapterId: string | null;
  readonly roleAssignments: readonly RoleAssignment[];
  readonly createdAt: Date | null;
  readonly lastSignInAt: Date | null;
  readonly version: number;
}

export interface CustomRole extends RoleDefinition {
  readonly color: RoleColor;
}

export interface StoredRole extends CustomRole {
  readonly version: number;
}

export interface AuditChange {
  readonly before: Snapshot | null;
  readonly after: Snapshot | null;
  readonly versionBefore: number | null;
  readonly versionAfter: number | null;
}

export type AuditFactory = (change: AuditChange) => AuditEvent;

export interface AccountChange {
  readonly roleAssignmentsFrom?: (current: UserSummary) => readonly RoleAssignment[];
  readonly status?: UserStatus;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toDate = (value: unknown): Date | null =>
  value instanceof Date
    ? value
    : isRecord(value) && typeof value["toDate"] === "function"
      ? (value as { toDate(): Date }).toDate()
      : null;

const parseScope = (scope: Record<string, unknown>): Scope | null => {
  const id = scope["type"] === "chapter" ? scope["chapterId"] : scope["orgUnitId"];
  if (scope["type"] === "global") return { type: "global" };
  if (typeof id !== "string" || !safeId.safeParse(id).success) return null;
  if (scope["type"] === "chapter") return { type: "chapter", chapterId: id };
  return scope["type"] === "orgUnit" ? { type: "orgUnit", orgUnitId: id } : null;
};

const isDefaultAssignment = (a: RoleAssignment) =>
  a.roleId === SYSTEM_ROLES.visitor.id && a.scope.type === "global" && !a.periodId && !a.revokedAt;

export function parseAssignments(value: unknown): RoleAssignment[] {
  const parsed = (Array.isArray(value) ? value : []).flatMap((item: unknown): RoleAssignment[] => {
    if (!isRecord(item) || !isRecord(item["scope"])) return [];
    const roleId = item["roleId"];
    const scope = parseScope(item["scope"]);
    if (typeof roleId !== "string" || !safeId.safeParse(roleId).success || !scope) return [];
    const periodId = typeof item["periodId"] === "string" ? item["periodId"] : null;
    const source = item["source"] === "appointment" ? "appointment" : "manual";
    const appointmentId =
      typeof item["appointmentId"] === "string" && safeId.safeParse(item["appointmentId"]).success
        ? item["appointmentId"]
        : null;
    const revokedAt = toDate(item["revokedAt"]);
    if (item["revokedAt"] !== undefined && item["revokedAt"] !== null && !revokedAt) return [];
    return [{ roleId, scope, periodId, source, revokedAt, appointmentId }];
  });
  return parsed.some(isDefaultAssignment) ? parsed : [...plainDefault(), ...parsed];
}

const plainDefault = (): RoleAssignment[] =>
  DEFAULT_ROLE_ASSIGNMENTS.map((a) => ({
    ...a,
    periodId: null,
    source: "manual",
    revokedAt: null,
    appointmentId: null,
  }));

export function parseCustomRole(id: string, data: unknown): CustomRole | null {
  if (isSystemRoleId(id) || !isRecord(data) || data["deletedAt"]) return null;
  const { name, permissions, color } = data;
  if (typeof name !== "string" || !Array.isArray(permissions)) return null;
  return {
    id,
    name,
    permissions: normalizePermissions(permissions.map(String)),
    color: isRoleColor(color) ? color : DEFAULT_ROLE_COLOR,
  };
}

export const systemRole = (id: string): RoleDefinition | null =>
  isSystemRoleId(id) ? SYSTEM_ROLES[id] : null;

export const customRoleIds = (assignments: readonly RoleAssignment[]): string[] => [
  ...new Set(assignments.map((a) => a.roleId).filter((id) => !isSystemRoleId(id))),
];

export function toPrincipal(
  uid: string,
  data: Record<string, unknown>,
  customRoles: ReadonlyMap<string, RoleDefinition>,
  activePeriodId: string | null = null,
): Principal {
  return {
    kind: "user",
    userId: uid,
    active: data["status"] === "active",
    assignments: resolveAssignments(
      parseAssignments(data["roleAssignments"]),
      customRoles,
      activePeriodId,
    ),
  };
}

export function toUserSummary(uid: string, data: Record<string, unknown>): UserSummary {
  return {
    uid,
    email: typeof data["email"] === "string" ? data["email"] : null,
    name: typeof data["name"] === "string" ? data["name"] : null,
    status: data["status"] === "active" ? "active" : "inactive",
    chapterId:
      typeof data["chapterId"] === "string" && safeId.safeParse(data["chapterId"]).success
        ? data["chapterId"]
        : null,
    roleAssignments: parseAssignments(data["roleAssignments"]),
    createdAt: toDate(data["createdAt"]),
    lastSignInAt: toDate(data["lastSignInAt"]),
    version: typeof data["version"] === "number" ? data["version"] : 0,
  };
}

export const roleIdsOf = (assignments: readonly RoleAssignment[]): string[] => [
  ...new Set(assignments.map((a) => a.roleId)),
];

export const isActiveSuperadmin = (user: UserSummary): boolean =>
  user.status === "active" &&
  user.roleAssignments.some(
    (a) => a.roleId === "superadmin" && a.scope.type === "global" && !a.revokedAt && !a.periodId,
  );

export const plainAssignments = (assignments: readonly RoleAssignment[]) =>
  assignments.map((a) => ({
    roleId: a.roleId,
    scope: { ...a.scope },
    periodId: a.periodId ?? null,
    source: a.source ?? "manual",
    revokedAt: a.revokedAt ?? null,
    appointmentId: a.appointmentId ?? null,
  }));

export const accountSnapshot = (
  user: Pick<UserSummary, "roleAssignments" | "status">,
): Snapshot => ({
  status: user.status,
  roleAssignments: plainAssignments(user.roleAssignments).map((a) => ({
    ...a,
    revokedAt: a.revokedAt?.toISOString() ?? null,
  })),
});
