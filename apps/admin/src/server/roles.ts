import "server-only";
import { z } from "zod";
import type { CustomRole } from "@website/db";
import type { SqlRoleStore } from "@website/db/sql";
import { RuleViolationError } from "@website/domain/shared";
import {
  canDeleteRole,
  canSaveRole,
  isSystemRoleId,
  normalizePermissions,
  PAGE_PERMISSIONS,
  ROLE_COLORS,
  type Principal,
} from "@website/permissions";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface RoleDeps {
  readonly roles: Pick<SqlRoleStore, "save" | "remove" | "get">;
  readonly now: () => Date;
}

export function roleIdFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

const SaveInput = z
  .object({
    id: safeId.optional(),
    name: safeText(60).pipe(z.string().min(2, "Give the role a name (2–60 characters).")),
    color: z.enum(ROLE_COLORS, "Choose a colour."),
    permissions: z.array(z.string().max(80)).max(PAGE_PERMISSIONS.length * 2),
    version: z.number().int().min(1).nullable(),
  })
  .strict();
const DeleteInput = z.object({ id: safeId, version: z.number().int().min(1) }).strict();

const ESCALATION =
  "You can only create or change roles with permissions you hold yourself (globally).";

export function createRoleActions(deps: RoleDeps) {
  const save = async (
    role: CustomRole,
    version: number | null,
    principal: Principal,
    audit: AuditBuilder,
  ) =>
    deps.roles.save(
      role,
      version,
      (previous) => {
        if (version === null && previous !== null) {
          throw new RuleViolationError(
            "A role with this name already exists. Choose another name.",
          );
        }
        if (!canSaveRole(principal, role, previous ?? undefined)) {
          throw new RuleViolationError(ESCALATION);
        }
      },
      (change) =>
        audit({
          module: "roles",
          action: version === null ? "CREATE" : "UPDATE",
          resourceType: "role",
          resourceId: role.id,
          title: role.name,
          ...change,
          revertible: false,
        }),
      deps.now(),
    );

  const saveRole = createGuardedAction({
    permission: "roles.edit",
    input: SaveInput,
    recentSignIn: true,
    handler: async (input, principal, audit) => {
      const id = input.id ?? roleIdFromName(input.name);
      if (!safeId.safeParse(id).success || id.length < 2) {
        throw new RuleViolationError("Use letters or numbers in the role name.");
      }
      if (isSystemRoleId(id)) throw new RuleViolationError("Built-in roles cannot be changed.");
      const role = {
        id,
        name: input.name,
        color: input.color,
        permissions: normalizePermissions(input.permissions),
      };
      const saved = await save(role, input.version, principal, audit);
      return { id: saved.id, version: saved.version };
    },
  });

  const deleteRole = createGuardedAction({
    permission: "roles.edit",
    input: DeleteInput,
    recentSignIn: true,
    handler: async (input, principal, audit) => {
      if (isSystemRoleId(input.id))
        throw new RuleViolationError("Built-in roles cannot be deleted.");
      await deps.roles.remove(
        input.id,
        input.version,
        (previous, holders) => {
          if (!canDeleteRole(principal, previous)) throw new RuleViolationError(ESCALATION);
          if (holders > 0) {
            throw new RuleViolationError(
              `${holders} account(s) still hold this role. Remove it from them in Role Manager first.`,
            );
          }
        },
        (change) =>
          audit({
            module: "roles",
            action: "DELETE",
            resourceType: "role",
            resourceId: input.id,
            title: input.id,
            ...change,
            revertible: false,
          }),
        deps.now(),
      );
      return { id: input.id };
    },
  });

  return { saveRole, deleteRole };
}
