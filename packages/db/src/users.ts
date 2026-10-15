import {
  isSystemRoleId,
  normalizePermissions,
  resolveAssignments,
  SYSTEM_ROLES,
  type Principal,
  type RoleAssignment,
  type RoleDefinition,
} from "@website/permissions";
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
  recordSignIn(identity: SignInIdentity, now: Date): Promise<void>;
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
