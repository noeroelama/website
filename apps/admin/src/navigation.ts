import {
  canAccessAdmin,
  canInSomeScope,
  type AdminPageId,
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
  /** Other audited pages shown under this page's Audit Log tab (their entries belong to it). */
  readonly also?: readonly AdminPageId[];
}

/**
 * The admin side panel, in display order. A page appears only when the signed-in staff member
 * can read it in some scope; the page itself re-checks `can()` for every action.
 * Hiding a link is a convenience, never the security boundary.
 */
export const ADMIN_NAVIGATION: readonly NavEntry[] = [
  { label: "Dashboard", href: "/", permission: null },
  // Every staff member: their own follow-ups, dispositions and milestones (G1).
  { label: "My Tasks", href: "/tasks", permission: null },
  { label: "Calendar", href: "/calendar", permission: "calendar.read" },
  { label: "Tools", href: "/tools", permission: "tools.read" },
  { label: "Event", href: "/events", permission: "events.read", also: ["registrants"] },
  { label: "Gallery", href: "/gallery", permission: "gallery.read" },
  { label: "Article", href: "/articles", permission: "articles.read" },
  { label: "Newsletter", href: "/newsletter", permission: "newsletter.read" },
  { label: "Forms", href: "/forms", permission: "forms.read" },
  { label: "Recruitment", href: "/recruitment", permission: "recruitment.read" },
  { label: "Letters", href: "/letters", permission: "letters.read", also: ["letter_types"] },
  { label: "Incoming letters", href: "/incoming", permission: "incoming.read" },
  {
    label: "Organizations",
    href: "/organizations",
    permission: "organizations.read",
    also: ["periods", "structure", "appointments"],
  },
  { label: "Universities", href: "/universities", permission: "universities.read" },
  // People and their roles (users.read); the roles themselves are under "Edit Role" (roles.read).
  { label: "Role Manager", href: "/roles", permission: "users.read", also: ["roles"] },
  { label: "Audit Log", href: "/audit", permission: "audit.read" },
  // E-mails sent by the system (failed ones can be retried). Profile and Account are on the web app.
  { label: "Email", href: "/emails", permission: "messages.read" },
  { label: "OKR", href: "/okr", permission: "okr.read" },
  { label: "Programmes", href: "/programs", permission: "programs.read" },
  { label: "LPJ", href: "/lpj", permission: "lpj.read" },
  { label: "Finance", href: "/finance", permission: "finance.read" },
  { label: "Meetings", href: "/meetings", permission: "meetings.read" },
  { label: "Zoom", href: "/zoom", permission: "zoom.read" },
  { label: "Settings", href: "/settings", permission: "settings.read" },
];

export function navigationFor(principal: Principal): NavItem[] {
  if (!canAccessAdmin(principal)) return [];
  return ADMIN_NAVIGATION.filter(
    (entry) => entry.permission === null || canInSomeScope(principal, entry.permission),
  ).map(({ label, href }) => ({ label, href }));
}
