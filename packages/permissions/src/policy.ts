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
  { readonly type: "global" } | { readonly type: "chapter"; readonly chapterId: string };

/** `users/{uid}.status`: an inactive account can do nothing (and cannot sign in). */
export const ACCOUNT_STATUSES = ["active", "inactive"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** What is stored in `users/{uid}.roleAssignments`. */
export interface RoleAssignment {
  readonly roleId: string;
  readonly scope: Scope;
}

/** An assignment with its role's permissions resolved on the server for this request. */
export interface ResolvedAssignment extends RoleAssignment {
  readonly permissions: ReadonlySet<PagePermission>;
}

/**
 * The server-side view of who is acting. One shape for every account (staff, member,
 * customer). Built ONLY on the server from a verified session + the user record and role
 * documents in Firestore — never from client input, URL params, payload fields or token claims.
 */
export interface Principal {
  readonly kind: "user";
  /** Firebase Auth uid; also the Firestore document id in `users`. */
  readonly userId: string;
  readonly active: boolean;
  readonly assignments: readonly ResolvedAssignment[];
}

export interface ResourceContext {
  /** Present when the resource belongs to a chapter; enables chapter-scoped assignments. */
  readonly chapterId?: string;
  /** Present for user-owned resources; required by `*_own` permissions. */
  readonly ownerId?: string;
}

/** Roles every new account receives on first sign-in. */
export const DEFAULT_ROLE_ASSIGNMENTS: readonly RoleAssignment[] = [
  { roleId: "user", scope: { type: "global" } },
];

/**
 * Turns stored assignments into resolved ones. Built-in roles always come from code; an
 * assignment to a role that no longer exists is dropped (fail closed).
 */
export function resolveAssignments(
  stored: readonly RoleAssignment[],
  customRoles: ReadonlyMap<string, RoleDefinition>,
): ResolvedAssignment[] {
  return stored.flatMap((assignment) => {
    const role = isSystemRoleId(assignment.roleId)
      ? SYSTEM_ROLES[assignment.roleId]
      : customRoles.get(assignment.roleId);
    if (role === undefined) return [];
    return [{ ...assignment, permissions: new Set(normalizePermissions(role.permissions)) }];
  });
}

function scopeCovers(scope: Scope, resource: ResourceContext | undefined): boolean {
  if (scope.type === "global") return true;
  return resource?.chapterId !== undefined && resource.chapterId === scope.chapterId;
}

const isOwnPermission = (permission: Permission) => permission.endsWith("_own");

/** Deny by default. Inactive principals can do nothing. */
export function can(
  principal: Principal | null,
  permission: Permission,
  resource?: ResourceContext,
): boolean {
  if (principal === null || !principal.active) return false;
  if (isOwnPermission(permission)) {
    // Every active account has self-service permissions, for its OWN resources only.
    return resource?.ownerId !== undefined && resource.ownerId === principal.userId;
  }
  return principal.assignments.some(
    (assignment) =>
      assignment.permissions.has(permission as PagePermission) &&
      scopeCovers(assignment.scope, resource),
  );
}

/**
 * True when the principal holds the permission in at least one scope. For deciding what to SHOW
 * (e.g. which admin pages appear in the navigation); every action still checks `can()` with the
 * resource, so a chapter assignment only ever reaches its own chapter's data.
 */
export function canInSomeScope(principal: Principal | null, permission: PagePermission): boolean {
  if (principal === null || !principal.active) return false;
  return principal.assignments.some((a) => a.permissions.has(permission));
}

/** True when the principal may enter the admin area at all (any admin-page permission). */
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

/** Throwing variant for server handlers. */
export function requirePermission(
  principal: Principal | null,
  permission: Permission,
  resource?: ResourceContext,
): asserts principal is Principal {
  if (principal === null || !principal.active) throw new UnauthenticatedError();
  if (!can(principal, permission, resource)) throw new ForbiddenError(permission);
}

/** Holds every listed permission in a GLOBAL assignment (chapter assignments never grant). */
function holdsGlobally(principal: Principal | null, permissions: readonly PagePermission[]) {
  return permissions.every((permission) => can(principal, permission));
}

/**
 * Creating or editing a custom role (Roles page). Anti-escalation: `roles.edit`, and the editor
 * must hold globally every permission the role gets AND (when editing) every permission it had.
 * Built-in roles can never be saved.
 */
export function canSaveRole(
  principal: Principal | null,
  role: RoleDefinition,
  previous?: RoleDefinition,
): boolean {
  if (isSystemRoleId(role.id) || !can(principal, "roles.edit")) return false;
  return holdsGlobally(principal, [...role.permissions, ...(previous?.permissions ?? [])]);
}

/** Deleting a custom role: same rule as editing it. Built-in roles can never be deleted. */
export function canDeleteRole(principal: Principal | null, role: RoleDefinition): boolean {
  return canSaveRole(principal, role);
}

/**
 * Assigning a role to a user: `users.edit` and every permission of that role (no granting what
 * you lack). Superadmin is assigned only by a superadmin.
 */
export function canAssignRole(principal: Principal | null, role: RoleDefinition): boolean {
  if (!can(principal, "users.edit")) return false;
  if (role.id === SUPERADMIN_ROLE_ID) {
    return (
      principal?.assignments.some(
        (a) => a.roleId === SUPERADMIN_ROLE_ID && a.scope.type === "global",
      ) ?? false
    );
  }
  return holdsGlobally(principal, role.permissions);
}

/** Why an account change is refused; null = allowed. */
export type AccountChangeRefusal = "self" | "forbidden" | "last_superadmin";

/**
 * Users page rules for adding/removing a role or changing an account's status:
 * nobody changes their own account; `users.edit` + `canAssignRole` for the role concerned
 * (you cannot add or remove what you could not grant; superadmin only by a superadmin);
 * the organisation never ends up without an active global superadmin.
 */
export function accountChangeRefusal(input: {
  readonly actor: Principal | null;
  readonly targetUserId: string;
  /** The role added or removed; omit for a status change. */
  readonly role?: RoleDefinition;
  /** Active global superadmins once the change is applied (read in the same transaction). */
  readonly superadminsAfter: number;
}): AccountChangeRefusal | null {
  const { actor, targetUserId, role, superadminsAfter } = input;
  if (actor !== null && actor.userId === targetUserId) return "self";
  const allowed = role ? canAssignRole(actor, role) : can(actor, "users.edit");
  if (!allowed) return "forbidden";
  if (superadminsAfter === 0) return "last_superadmin";
  return null;
}
