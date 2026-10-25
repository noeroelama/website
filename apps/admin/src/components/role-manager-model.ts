import { ADMIN_PAGES, isPagePermission, type RoleAssignment } from "@website/permissions";

/*
 * Pure rules of the Role Manager page (people and their roles; Edit Role). The React side is
 * `role-manager-page.tsx`; the server rules are in `src/server/accounts.ts` and `roles.ts`.
 */

/** Every account has it; it is never shown, filtered by or given here. */
export const DEFAULT_ROLE_ID = "user";

export type PersonStatus = "active" | "inactive" | "invited";

/** One row of the people table: an account holding a role, or a pending invite. */
export interface PersonRow {
  /** The uid, or `invite:<email>`. */
  readonly id: string;
  /** null for an invite (no account yet). */
  readonly uid: string | null;
  /** Full name, else the e-mail, else the uid. */
  readonly name: string;
  readonly email: string | null;
  readonly status: PersonStatus;
  readonly version: number;
  readonly createdAt: string | null;
  readonly lastSignInAt: string | null;
  /** Active roles (not ended), without the default role. */
  readonly roleIds: readonly string[];
  /** The roles of `roleIds` that can be removed here: all chapters, any period, given by hand. */
  readonly removable: readonly string[];
}

interface AccountLike {
  readonly uid: string;
  readonly email: string | null;
  readonly name: string | null;
  readonly status: "active" | "inactive";
  readonly version: number;
  readonly createdAt: Date | null;
  readonly lastSignInAt: Date | null;
  readonly roleAssignments: readonly RoleAssignment[];
}

const unique = (ids: string[]) => [...new Set(ids)];

/** Given by hand for all chapters and any period: what Add New People and the popup change. */
const isPlain = (a: RoleAssignment) =>
  a.scope.type === "global" && !a.periodId && a.source !== "appointment";

export function personRow(user: AccountLike): PersonRow {
  const active = user.roleAssignments.filter((a) => !a.revokedAt && a.roleId !== DEFAULT_ROLE_ID);
  return {
    id: user.uid,
    uid: user.uid,
    name: user.name ?? user.email ?? user.uid,
    email: user.email,
    status: user.status,
    version: user.version,
    createdAt: user.createdAt?.toISOString() ?? null,
    lastSignInAt: user.lastSignInAt?.toISOString() ?? null,
    roleIds: unique(active.map((a) => a.roleId)),
    removable: unique(active.filter(isPlain).map((a) => a.roleId)),
  };
}

export function inviteRow(invite: {
  readonly email: string;
  readonly roleIds: readonly string[];
  readonly createdAt: Date | null;
}): PersonRow {
  return {
    id: `invite:${invite.email}`,
    uid: null,
    name: invite.email,
    email: invite.email,
    status: "invited",
    version: 0,
    createdAt: invite.createdAt?.toISOString() ?? null,
    lastSignInAt: null,
    roleIds: [...invite.roleIds],
    removable: [],
  };
}

/** Tab (`all` or a role id) and the search text (name or e-mail). */
export function matchesPerson(row: PersonRow, filter: { tab: string; query: string }): boolean {
  const query = filter.query.trim().toLowerCase();
  return (
    (filter.tab === "all" || row.roleIds.includes(filter.tab)) &&
    (query === "" ||
      row.name.toLowerCase().includes(query) ||
      (row.email ?? "").toLowerCase().includes(query))
  );
}

/** "All" plus one tab per role somebody holds, in the roles' order, with counts. */
export function roleTabs(
  rows: readonly PersonRow[],
  roles: readonly { id: string; name: string }[],
): { key: string; label: string; count: number }[] {
  const count = (id: string) => rows.filter((r) => r.roleIds.includes(id)).length;
  return [
    { key: "all", label: "All", count: rows.length },
    ...roles
      .filter((role) => role.id !== DEFAULT_ROLE_ID && count(role.id) > 0)
      .map((role) => ({ key: role.id, label: role.name, count: count(role.id) })),
  ];
}

export type PersonSortKey = "name" | "role";

export function personSortValue(
  row: PersonRow,
  key: PersonSortKey,
  roleNames: ReadonlyMap<string, string>,
): string {
  if (key === "name") return row.name.toLowerCase();
  const first = row.roleIds[0];
  return first === undefined ? "" : (roleNames.get(first) ?? first).toLowerCase();
}

/** Roles to give and to remove when the person popup is saved. */
export function roleChanges(
  before: readonly string[],
  after: readonly string[],
): { add: string[]; remove: string[] } {
  return {
    add: after.filter((id) => !before.includes(id)),
    remove: before.filter((id) => !after.includes(id)),
  };
}

const channel = (hex: string, at: number) => {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/**
 * Text colour on a role badge: whichever of dark or light text has the higher contrast with the
 * badge colour (WCAG relative luminance; the two are equal at about 0.18).
 */
export function roleInk(hex: string): "dark" | "light" {
  const luminance = 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
  return luminance > 0.179 ? "dark" : "light";
}

/** Edit Role search: the role name or one of its permissions. */
export function matchesRole(
  role: { readonly name: string; readonly permissions: readonly string[] },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  return (
    q === "" ||
    role.name.toLowerCase().includes(q) ||
    role.permissions.some((p) => p.toLowerCase().includes(q))
  );
}

/** "shop_orders" → "Shop Orders", "revert" → "Revert". */
const title = (key: string) =>
  key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export interface PermissionGroup {
  readonly page: string;
  /** The admin page's label ("Audit Log"). */
  readonly label: string;
  /** Read, Edit and the page's extras: `{ value: "audit.revert", label: "Audit Revert" }`. */
  readonly permissions: readonly { readonly value: string; readonly label: string }[];
}

/** The permission checkboxes of Create / Edit Role: one group per admin page. */
export function permissionGroups(): PermissionGroup[] {
  return Object.entries(ADMIN_PAGES).map(
    ([page, definition]: [string, { label: string; extras?: Record<string, string> }]) => ({
      page,
      label: definition.label,
      permissions: ["read", "edit", ...Object.keys(definition.extras ?? {})].map((action) => ({
        value: `${page}.${action}`,
        label: `${title(page)} ${title(action)}`,
      })),
    }),
  );
}

/**
 * The permission dropdown's search: a page whose label matches keeps all its permissions;
 * otherwise only the permissions whose label or key matches (pages without any are left out).
 */
export function filterPermissionGroups(
  groups: readonly PermissionGroup[],
  query: string,
): PermissionGroup[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...groups];
  const matches = (text: string) => text.toLowerCase().includes(q);
  return groups
    .map((group) =>
      matches(group.label)
        ? group
        : {
            ...group,
            permissions: group.permissions.filter((p) => matches(p.label) || matches(p.value)),
          },
    )
    .filter((group) => group.permissions.length > 0);
}

/**
 * A role's permissions as the checkboxes show them: `pages` = pages ticked as a whole (the role
 * has every permission of the page), `single` = the other permissions. Unknown ones are dropped.
 */
export function splitPermissions(permissions: readonly string[]): {
  pages: Set<string>;
  single: Set<string>;
} {
  const held = new Set<string>(permissions.filter(isPagePermission));
  const pages = new Set(
    permissionGroups()
      .filter((group) => group.permissions.every((p) => held.has(p.value)))
      .map((group) => group.page),
  );
  const single = new Set([...held].filter((p) => !pages.has(p.slice(0, p.lastIndexOf(".")))));
  return { pages, single };
}

/** What is saved: every permission of the ticked pages plus the single ones. */
export function joinPermissions(pages: ReadonlySet<string>, single: ReadonlySet<string>): string[] {
  return [
    ...permissionGroups()
      .filter((group) => pages.has(group.page))
      .flatMap((group) => group.permissions.map((p) => p.value)),
    ...single,
  ];
}
