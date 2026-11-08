import {
  isSystemRoleId,
  normalizePermissions,
  SUPERADMIN_ROLE_ID,
  SYSTEM_ROLES,
  type PagePermission,
  type Permission,
  type RoleDefinition,
} from "./permissions";

export type Scope =
  | { readonly type: "global" }
  | { readonly type: "chapter"; readonly chapterId: string }
  | { readonly type: "orgUnit"; readonly orgUnitId: string };

export const ACCOUNT_STATUSES = ["active", "inactive"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export interface RoleAssignment {
  readonly roleId: string;
  readonly scope: Scope;
  readonly periodId?: string | null;
  readonly source?: "appointment" | "manual";
  readonly appointmentId?: string | null;
  readonly revokedAt?: Date | null;
}

export interface ResolvedAssignment extends RoleAssignment {
  readonly permissions: ReadonlySet<PagePermission>;
}

export interface Principal {
  readonly kind: "user";
  readonly userId: string;
  readonly active: boolean;
  readonly assignments: readonly ResolvedAssignment[];
}

export interface ResourceContext {
  readonly chapterId?: string;
  readonly orgUnitPath?: readonly string[];
  readonly ownerId?: string;
}

export const DEFAULT_ROLE_ASSIGNMENTS: readonly RoleAssignment[] = [
  { roleId: "visitor", scope: { type: "global" } },
];

export const isWebsiteRole = (a: RoleAssignment): boolean =>
  a.scope.type === "global" &&
  !a.periodId &&
  a.source !== "appointment" &&
  !a.revokedAt &&
  a.roleId !== SYSTEM_ROLES.visitor.id;

export function resolveAssignments(
  stored: readonly RoleAssignment[],
  customRoles: ReadonlyMap<string, RoleDefinition>,
  activePeriodId: string | null = null,
): ResolvedAssignment[] {
  return stored.flatMap((assignment) => {
    if (assignment.revokedAt) return [];
    if (assignment.periodId && assignment.periodId !== activePeriodId) return [];
    const role = isSystemRoleId(assignment.roleId)
      ? SYSTEM_ROLES[assignment.roleId]
      : customRoles.get(assignment.roleId);
    if (role === undefined) return [];
    return [{ ...assignment, permissions: new Set(normalizePermissions(role.permissions)) }];
  });
}

export function sameScope(a: Scope, b: Scope): boolean {
  if (a.type === "chapter" && b.type === "chapter") return a.chapterId === b.chapterId;
  if (a.type === "orgUnit" && b.type === "orgUnit") return a.orgUnitId === b.orgUnitId;
  return a.type === "global" && b.type === "global";
}

function scopeCovers(scope: Scope, resource: ResourceContext | undefined): boolean {
  if (scope.type === "global") return true;
  if (scope.type === "orgUnit") return resource?.orgUnitPath?.includes(scope.orgUnitId) ?? false;
  return resource?.chapterId !== undefined && resource.chapterId === scope.chapterId;
}

const isOwnPermission = (permission: Permission) => permission.endsWith("_own");

export function can(
  principal: Principal | null,
  permission: Permission,
  resource?: ResourceContext,
): boolean {
  if (principal === null || !principal.active) return false;
  if (isOwnPermission(permission)) {
    return resource?.ownerId !== undefined && resource.ownerId === principal.userId;
  }
  return principal.assignments.some(
    (assignment) =>
      assignment.permissions.has(permission as PagePermission) &&
      scopeCovers(assignment.scope, resource),
  );
}

export function canInSomeScope(principal: Principal | null, permission: PagePermission): boolean {
  if (principal === null || !principal.active) return false;
  return principal.assignments.some((a) => a.permissions.has(permission));
}

export function scopedChapterIds(
  principal: Principal | null,
  permission: PagePermission,
): "all" | string[] {
  if (principal === null || !principal.active) return [];
  const holding = principal.assignments.filter((a) => a.permissions.has(permission));
  if (holding.some((a) => a.scope.type === "global")) return "all";
  return [
    ...new Set(holding.flatMap((a) => (a.scope.type === "chapter" ? [a.scope.chapterId] : []))),
  ];
}

export function scopedOrgUnitIds(
  principal: Principal | null,
  permission: PagePermission,
): "all" | string[] {
  if (principal === null || !principal.active) return [];
  const holding = principal.assignments.filter((a) => a.permissions.has(permission));
  if (holding.some((a) => a.scope.type === "global")) return "all";
  return [
    ...new Set(holding.flatMap((a) => (a.scope.type === "orgUnit" ? [a.scope.orgUnitId] : []))),
  ];
}

export function canAccessAdmin(principal: Principal | null): boolean {
  if (principal === null || !principal.active) return false;
  return principal.assignments.some((a) => a.permissions.size > 0);
}

export class ForbiddenError extends Error {
  override readonly name = "ForbiddenError";
  constructor(readonly permission: Permission) {
    super(`Missing permission: ${permission}`);
  }
}

export class UnauthenticatedError extends Error {
  override readonly name = "UnauthenticatedError";
  constructor() {
    super("Authentication required");
  }
}

export function requirePermission(
  principal: Principal | null,
  permission: Permission,
  resource?: ResourceContext,
): asserts principal is Principal {
  if (principal === null || !principal.active) throw new UnauthenticatedError();
  if (!can(principal, permission, resource)) throw new ForbiddenError(permission);
}

function holdsGlobally(principal: Principal | null, permissions: readonly PagePermission[]) {
  return permissions.every((permission) => can(principal, permission));
}

export function canSaveRole(
  principal: Principal | null,
  role: RoleDefinition,
  previous?: RoleDefinition,
): boolean {
  if (isSystemRoleId(role.id) || !can(principal, "roles.edit")) return false;
  return holdsGlobally(principal, [...role.permissions, ...(previous?.permissions ?? [])]);
}

export function canDeleteRole(principal: Principal | null, role: RoleDefinition): boolean {
  return canSaveRole(principal, role);
}

export function isSuperadmin(principal: Principal | null): boolean {
  return (
    principal !== null &&
    principal.active &&
    principal.assignments.some((a) => a.roleId === SUPERADMIN_ROLE_ID && a.scope.type === "global")
  );
}

export function canAssignRole(principal: Principal | null, role: RoleDefinition): boolean {
  if (!can(principal, "users.edit")) return false;
  if (role.id === SUPERADMIN_ROLE_ID) return isSuperadmin(principal);
  return holdsGlobally(principal, role.permissions);
}

export function canAppointInto(principal: Principal | null, role: RoleDefinition): boolean {
  if (isSystemRoleId(role.id) || !can(principal, "appointments.edit")) return false;
  return holdsGlobally(principal, role.permissions);
}

export function canRatifyInto(principal: Principal | null, role: RoleDefinition): boolean {
  if (isSystemRoleId(role.id) || !can(principal, "recruitment.confirm")) return false;
  return holdsGlobally(principal, role.permissions);
}

export type AccountChangeRefusal = "self" | "forbidden" | "last_superadmin";

export function accountChangeRefusal(input: {
  readonly actor: Principal | null;
  readonly targetUserId: string;
  readonly role?: RoleDefinition;
  readonly superadminsAfter: number;
}): AccountChangeRefusal | null {
  const { actor, targetUserId, role, superadminsAfter } = input;
  if (actor !== null && actor.userId === targetUserId) return "self";
  const allowed = role ? canAssignRole(actor, role) : can(actor, "users.edit");
  if (!allowed) return "forbidden";
  if (superadminsAfter === 0) return "last_superadmin";
  return null;
}
