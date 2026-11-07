import {
  canAccessAdmin,
  canInSomeScope,
  type AdminPageId,
  type PagePermission,
  type Principal,
} from "@website/permissions";

/** Side-panel sections; each entry names its own, and a group's entries stay together. */
type NavGroup = "Workspace" | "Content" | "Organization" | "Planning" | "Administration";

/** What the side panel renders. Only group, label and link reach the browser. */
export interface NavItem {
  readonly group: NavGroup;
  readonly label: string;
  readonly href: string;
}

interface NavEntry extends NavItem {
  /** Permission needed to see the page; `null` = every staff member (the dashboard). */
  readonly permission: PagePermission | null;
  /** Other audited pages shown under this page's Audit Log tab (their entries belong to it). */
  readonly also?: readonly AdminPageId[];
}

/**
 * The admin side panel, in display order. A page appears only when the signed-in staff member
 * can read it in some scope; the page itself re-checks `can()` for every action.
 * Hiding a link is a convenience, never the security boundary.
 */
export const ADMIN_NAVIGATION: readonly NavEntry[] = [
  { group: "Workspace", label: "Dashboard", href: "/", permission: null },
  // Every staff member: their own follow-ups, dispositions and milestones (G1).
  { group: "Workspace", label: "My Tasks", href: "/tasks", permission: null },
  { group: "Workspace", label: "Calendar", href: "/calendar", permission: "calendar.read" },
  { group: "Workspace", label: "Tools", href: "/tools", permission: "tools.read" },
  {
    group: "Content",
    label: "Event",
    href: "/events",
    permission: "events.read",
    also: ["registrants"],
  },
  { group: "Content", label: "Gallery", href: "/gallery", permission: "gallery.read" },
  { group: "Content", label: "Article", href: "/articles", permission: "articles.read" },
  { group: "Content", label: "Newsletter", href: "/newsletter", permission: "newsletter.read" },
  { group: "Content", label: "Forms", href: "/forms", permission: "forms.read" },
  {
    group: "Organization",
    label: "Recruitment",
    href: "/recruitment",
    permission: "recruitment.read",
  },
  // Outgoing, incoming letters and letter types are tabs of one page.
  {
    group: "Organization",
    label: "Letter",
    href: "/letters",
    permission: "letters.read",
    also: ["letter_types", "incoming"],
  },
  {
    group: "Organization",
    label: "Organizations",
    href: "/organizations",
    permission: "organizations.read",
    also: ["periods", "structure", "appointments", "universities"],
  },
  { group: "Planning", label: "OKR", href: "/okr", permission: "okr.read" },
  { group: "Planning", label: "Programmes", href: "/programs", permission: "programs.read" },
  { group: "Planning", label: "LPJ", href: "/lpj", permission: "lpj.read" },
  { group: "Planning", label: "Finance", href: "/finance", permission: "finance.read" },
  { group: "Planning", label: "Meetings", href: "/meetings", permission: "meetings.read" },
  { group: "Planning", label: "Zoom", href: "/zoom", permission: "zoom.read" },
  // People and their roles (users.read); the roles themselves are under "Edit Role" (roles.read).
  {
    group: "Administration",
    label: "Role Manager",
    href: "/roles",
    permission: "users.read",
    also: ["roles"],
  },
  { group: "Administration", label: "Audit Log", href: "/audit", permission: "audit.read" },
  // E-mails sent by the system (failed ones can be retried). Profile and Account are on the web app.
  { group: "Administration", label: "Email", href: "/emails", permission: "messages.read" },
  { group: "Administration", label: "Settings", href: "/settings", permission: "settings.read" },
];

export function navigationFor(principal: Principal): NavItem[] {
  if (!canAccessAdmin(principal)) return [];
  return ADMIN_NAVIGATION.filter(
    (entry) => entry.permission === null || canInSomeScope(principal, entry.permission),
  ).map(({ group, label, href }) => ({ group, label, href }));
}
