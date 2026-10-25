/**
 * Permission vocabulary.
 *
 * - Self-service permissions (`*_own`) belong to every active account, for its own data only.
 * - Admin permissions come from ADMIN PAGES: every page has `<page>.read` and `<page>.edit`
 *   (edit includes read) and, where needed, named extras (e.g. `members.pii`). Adding a page is
 *   a reviewed code change; WHICH roles get which page permissions is data, edited in the admin
 *   Role Manager (roles are Firestore documents).
 */
export const SELF_SERVICE_PERMISSIONS = [
  "profile.read_own",
  "profile.write_own",
  "events.register",
  "registrations.read_own",
  "applications.read_own",
  "applications.write_own",
  "shop.orders.read_own",
] as const;
export type SelfServicePermission = (typeof SELF_SERVICE_PERMISSIONS)[number];

interface AdminPageDefinition {
  /** Shown in Role Manager. */
  readonly label: string;
  /** Extra permissions beyond read/edit: key → label shown as a checkbox. */
  readonly extras?: Readonly<Record<string, string>>;
}

export const ADMIN_PAGES = {
  tools: { label: "Tools" },
  events: { label: "Event" },
  registrants: { label: "Event registrants", extras: { export: "Export registrants" } },
  gallery: { label: "Gallery" },
  articles: { label: "Article", extras: { publish: "Publish" } },
  newsletter: {
    label: "Newsletter",
    extras: { send: "Send campaigns", export: "Export subscribers" },
  },
  forms: {
    label: "Forms",
    extras: {
      publish: "Publish and close public forms",
      responses: "See responses",
      export: "Export responses",
    },
  },
  recruitment: {
    label: "Recruitment (Oprec)",
    extras: {
      review: "Review applications (revision, fail, pass to interview)",
      offer: "Offer seats",
      confirm: "Approve placements and ratify (Sekjen)",
    },
  },
  letters: {
    label: "Letters",
    extras: {
      review: "Correct and pass or return letters (secretariat)",
      sign: "Sign as Secretary-General",
      sign_coordinator: "Sign as Coordinator",
      issue: "Issue letters (give the number)",
      cancel: "Cancel issued letters",
    },
  },
  letter_types: { label: "Letter types (number patterns)" },
  incoming: {
    label: "Incoming letters",
    extras: { dispose: "Dispose letters and complete dispositions" },
  },
  organizations: { label: "Organizations" },
  periods: { label: "Board periods" },
  structure: { label: "Organisation structure" },
  universities: { label: "Universities (campus proposals)" },
  appointments: { label: "Appointments (board seats → roles)" },
  members: {
    label: "Members",
    extras: {
      pii: "See personal data",
      export: "Export",
      approve: "Approve members",
    },
  },
  users: { label: "Users & role assignments" },
  roles: { label: "Roles & permissions" },
  audit: { label: "Audit Log", extras: { revert: "Revert changes" } },
  messages: { label: "Messages (failed e-mails, retry)" },
  apikeys: { label: "API keys" },
  shop_products: { label: "Shop products" },
  shop_orders: { label: "Shop orders", extras: { refund: "Refund" } },
} as const satisfies Record<string, AdminPageDefinition>;

export type AdminPageId = keyof typeof ADMIN_PAGES;
type ExtraOf<P extends AdminPageId> = (typeof ADMIN_PAGES)[P] extends {
  readonly extras: infer E;
}
  ? keyof E & string
  : never;
export type PagePermission = {
  [P in AdminPageId]: `${P}.read` | `${P}.edit` | `${P}.${ExtraOf<P>}`;
}[AdminPageId];
export type Permission = PagePermission | SelfServicePermission;

/** Every admin-page permission, page by page (read, edit, extras). */
export const PAGE_PERMISSIONS: readonly PagePermission[] = Object.entries(ADMIN_PAGES).flatMap(
  ([page, definition]: [string, AdminPageDefinition]) =>
    [
      `${page}.read`,
      `${page}.edit`,
      ...Object.keys(definition.extras ?? {}).map((extra) => `${page}.${extra}`),
    ] as PagePermission[],
);
const PAGE_PERMISSION_SET: ReadonlySet<string> = new Set(PAGE_PERMISSIONS);

export function isPagePermission(value: string): value is PagePermission {
  return PAGE_PERMISSION_SET.has(value);
}

/**
 * Cleans a permission list before it is stored on a role: unknown entries and self-service
 * permissions are dropped, and `edit` or any extra adds `read` of the same page.
 */
export function normalizePermissions(values: Iterable<string>): PagePermission[] {
  const result = new Set<PagePermission>();
  for (const value of values) {
    if (!isPagePermission(value)) continue;
    result.add(value);
    if (!value.endsWith(".read")) {
      result.add(`${value.slice(0, value.lastIndexOf("."))}.read` as PagePermission);
    }
  }
  return [...result];
}

/**
 * Badge colours a role can have (Role Manager → Create Role). Display only: a colour never
 * changes what a role may do. Stored roles read without a known colour get `DEFAULT_ROLE_COLOR`.
 */
export const ROLE_COLORS = [
  "#D9534F",
  "#2E9FC9",
  "#123D5E",
  "#D4B25A",
  "#F5A623",
  "#4A5361",
  "#8B5CF6",
  "#10B981",
  "#EC4899",
  "#6366F1",
] as const;
export type RoleColor = (typeof ROLE_COLORS)[number];
export const DEFAULT_ROLE_COLOR: RoleColor = "#4A5361";

export function isRoleColor(value: unknown): value is RoleColor {
  return (ROLE_COLORS as readonly unknown[]).includes(value);
}

/** A role: built-in (code) or custom (Firestore `roles/{id}`, edited in the admin Role Manager). */
export interface RoleDefinition {
  readonly id: string;
  readonly name: string;
  readonly permissions: readonly PagePermission[];
  /** Badge colour (display only); roles read from Firestore always have one. */
  readonly color?: RoleColor;
}

export const SUPERADMIN_ROLE_ID = "superadmin";

/**
 * Built-in roles. They cannot be created, edited or deleted in the Role Manager, and a stored role
 * document with the same id is ignored.
 * - superadmin: every admin page (keep 2-3 people)
 * - member: an approved PPI member (self-service only, for now)
 * - user: every account (assigned on first sign-in)
 */
export const SYSTEM_ROLES = {
  [SUPERADMIN_ROLE_ID]: {
    id: SUPERADMIN_ROLE_ID,
    name: "Superadmin",
    permissions: PAGE_PERMISSIONS,
    color: "#D9534F",
  },
  member: { id: "member", name: "Member", permissions: [], color: "#10B981" },
  user: { id: "user", name: "User", permissions: [], color: DEFAULT_ROLE_COLOR },
} as const satisfies Record<string, RoleDefinition>;

export function isSystemRoleId(id: string): id is keyof typeof SYSTEM_ROLES {
  return Object.hasOwn(SYSTEM_ROLES, id);
}
