import "server-only";
import { z } from "zod";
import type { FirestoreRoleStore } from "@website/db/firestore";
import { RuleViolationError } from "@website/domain/shared";
import {
  canDeleteRole,
  canSaveRole,
  isSystemRoleId,
  normalizePermissions,
  PAGE_PERMISSIONS,
  type Principal,
  type RoleDefinition,
} from "@website/permissions";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface RoleDeps {
  readonly roles: Pick<FirestoreRoleStore, "save" | "remove" | "get">;
  readonly now: () => Date;
}

/** Role id from its name: "Chapter admin" → "chapter_admin". */
export function roleIdFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

const read = (pages: string[]) => pages.map((p) => `${p}.read`);

/**
 * Starting points offered on the Roles page ("Add suggested roles"). They become ordinary,
 * editable custom roles; scope (global or one chapter) is chosen when a role is assigned.
 */
export const SUGGESTED_ROLES: readonly RoleDefinition[] = [
  {
    id: "admin",
    name: "Admin",
    permissions: normalizePermissions(
      PAGE_PERMISSIONS.filter((p) => !p.startsWith("roles.") && !p.startsWith("apikeys.")),
    ),
  },
  {
    id: "editor",
    name: "Editor",
    permissions: normalizePermissions([
      "articles.edit",
      "articles.publish",
      "events.edit",
      "gallery.edit",
      "newsletter.edit",
    ]),
  },
  {
    id: "chapter_admin",
    name: "Chapter admin",
    permissions: normalizePermissions([
      "organizations.edit",
      "members.read",
      "members.approve",
      "events.edit",
      "articles.edit",
      "gallery.edit",
    ]),
  },
  {
    id: "chapter_editor",
    name: "Chapter editor",
    permissions: normalizePermissions(["articles.edit", "events.edit", "gallery.edit"]),
  },
  {
    id: "viewer",
    name: "Viewer",
    permissions: normalizePermissions(
      read(["events", "gallery", "articles", "newsletter", "organizations", "audit"]),
    ),
  },
  {
    id: "shop_manager",
    name: "Shop manager",
    permissions: normalizePermissions(["shop_products.edit", "shop_orders.edit"]),
  },
];

const SaveInput = z
  .object({
    /** Absent when creating: the id is made from the name. */
    id: safeId.optional(),
    name: safeText(60).pipe(z.string().min(2, "Give the role a name (2–60 characters).")),
    permissions: z.array(z.string().max(80)).max(PAGE_PERMISSIONS.length * 2),
    version: z.number().int().min(1).nullable(),
  })
  .strict();
const DeleteInput = z.object({ id: safeId, version: z.number().int().min(1) }).strict();

const ESCALATION =
  "You can only create or change roles with permissions you hold yourself (globally).";

/** Admin Roles page actions (roles are data, DEC-11). */
export function createRoleActions(deps: RoleDeps) {
  const save = async (
    role: RoleDefinition,
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
          revertible: false, // permissions change only through these rules, never through revert
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
      const role: RoleDefinition = {
        id,
        name: input.name,
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
              `${holders} account(s) still hold this role. Remove it from them on the Users page first.`,
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

  /** Creates the suggested roles that do not exist yet and that the editor may grant. */
  const addSuggestedRoles = createGuardedAction({
    permission: "roles.edit",
    input: z.object({}).strict(),
    recentSignIn: true,
    handler: async (_input, principal, audit) => {
      const added: string[] = [];
      for (const role of SUGGESTED_ROLES) {
        // One small transaction per role; skipped when it exists or would be an escalation.
        if ((await deps.roles.get(role.id)) !== null) continue;
        if (!canSaveRole(principal, role)) continue;
        await save(role, null, principal, audit);
        added.push(role.id);
      }
      return { added };
    },
  });

  return { saveRole, deleteRole, addSuggestedRoles };
}
