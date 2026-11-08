import {
  ADMIN_PAGES,
  isPagePermission,
  isWebsiteRole,
  type RoleAssignment,
} from "@website/permissions";

export const DEFAULT_ROLE_ID = "visitor";

export type PersonStatus = "active" | "inactive" | "invited";

export interface PersonRow {
  readonly id: string;
  readonly uid: string | null;
  readonly name: string;
  readonly email: string | null;
  readonly status: PersonStatus;
  readonly version: number;
  readonly createdAt: string | null;
  readonly lastSignInAt: string | null;
  readonly roleId: string | null;
  readonly orgRoleIds: readonly string[];
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
    roleId: active.find(isWebsiteRole)?.roleId ?? null,
    orgRoleIds: [...new Set(active.filter((a) => !isWebsiteRole(a)).map((a) => a.roleId))],
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
    roleId: invite.roleIds[0] ?? null,
    orgRoleIds: [],
  };
}

export function matchesPerson(row: PersonRow, filter: { tab: string; query: string }): boolean {
  const query = filter.query.trim().toLowerCase();
  return (
    (filter.tab === "all" || row.roleId === filter.tab) &&
    (query === "" ||
      row.name.toLowerCase().includes(query) ||
      (row.email ?? "").toLowerCase().includes(query))
  );
}

export function roleTabs(
  rows: readonly PersonRow[],
  roles: readonly { id: string; name: string }[],
): { key: string; label: string; count: number }[] {
  const count = (id: string) => rows.filter((r) => r.roleId === id).length;
  return [
    { key: "all", label: "All", count: rows.length },
    ...roles
      .filter((role) => role.id !== DEFAULT_ROLE_ID && count(role.id) > 0)
      .map((role) => ({ key: role.id, label: role.name, count: count(role.id) })),
  ];
}

export type PersonSortKey = "name" | "role" | "status" | "lastSignIn";

export function personSortValue(
  row: PersonRow,
  key: PersonSortKey,
  roleNames: ReadonlyMap<string, string>,
): string {
  if (key === "name") return row.name.toLowerCase();
  if (key === "status") return row.status;
  if (key === "lastSignIn") return row.lastSignInAt ?? "";
  return row.roleId === null ? "" : (roleNames.get(row.roleId) ?? row.roleId).toLowerCase();
}

const channel = (hex: string, at: number) => {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export function roleInk(hex: string): "dark" | "light" {
  const luminance = 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
  return luminance > 0.179 ? "dark" : "light";
}

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

const title = (key: string) =>
  key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

export interface PermissionGroup {
  readonly page: string;
  readonly label: string;
  readonly permissions: readonly { readonly value: string; readonly label: string }[];
}

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

export function joinPermissions(pages: ReadonlySet<string>, single: ReadonlySet<string>): string[] {
  return [
    ...permissionGroups()
      .filter((group) => pages.has(group.page))
      .flatMap((group) => group.permissions.map((p) => p.value)),
    ...single,
  ];
}
