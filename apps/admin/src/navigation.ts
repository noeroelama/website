import {
  canAccessAdmin,
  canInSomeScope,
  type PagePermission,
  type Principal,
} from "@website/permissions";

/** What the side panel renders. Only label and link reach the browser. */
export interface NavItem {
  readonly label: string;
  readonly href: string;
}

interface NavEntry extends NavItem {
  /** Permission needed to see the page; `null` = every staff member (the dashboard). */
  readonly permission: PagePermission | null;
}

/**
 * The admin side panel, in display order. A page appears only when the signed-in staff member
 * can read it in some scope; the page itself re-checks `can()` for every action.
 * Hiding a link is a convenience, never the security boundary.
 */
export const ADMIN_NAVIGATION: readonly NavEntry[] = [
  { label: "Dashboard", href: "/", permission: null },
  { label: "Tools", href: "/tools", permission: "tools.read" },
  { label: "Event", href: "/events", permission: "events.read" },
  { label: "Gallery", href: "/gallery", permission: "gallery.read" },
  { label: "Article", href: "/articles", permission: "articles.read" },
  { label: "Newsletter", href: "/newsletter", permission: "newsletter.read" },
  { label: "Organizations", href: "/organizations", permission: "organizations.read" },
  { label: "Universities", href: "/universities", permission: "universities.read" },
  { label: "Users", href: "/users", permission: "users.read" },
  { label: "Roles", href: "/roles", permission: "roles.read" },
  { label: "Audit Log", href: "/audit", permission: "audit.read" },
  { label: "Messages", href: "/messages", permission: "messages.read" },
];

export function navigationFor(principal: Principal): NavItem[] {
  if (!canAccessAdmin(principal)) return [];
  return ADMIN_NAVIGATION.filter(
    (entry) => entry.permission === null || canInSomeScope(principal, entry.permission),
  ).map(({ label, href }) => ({ label, href }));
}

/** Avatar initials: first + last name ("Nevyllo Zamuel Kalangi" → "NK"). */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (first === undefined) return "?";
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  return (
    last === undefined ? first.slice(0, 2) : `${first[0] ?? ""}${last[0] ?? ""}`
  ).toUpperCase();
}
