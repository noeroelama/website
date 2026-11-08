import {
  canAccessAdmin,
  canInSomeScope,
  isSuperadmin,
  type AdminPageId,
  type PagePermission,
  type Principal,
} from "@website/permissions";

type NavGroup = "Workspace" | "Content" | "Organization" | "Planning" | "Administration";

export interface NavItem {
  readonly group: NavGroup;
  readonly label: string;
  readonly href: string;
}

interface NavEntry extends NavItem {
  readonly permission: PagePermission | "superadmin" | null;
  readonly also?: readonly AdminPageId[];
}

export const ADMIN_NAVIGATION: readonly NavEntry[] = [
  { group: "Workspace", label: "Dashboard", href: "/", permission: null },
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
  {
    group: "Administration",
    label: "Role Manager",
    href: "/roles",
    permission: "users.read",
    also: ["roles"],
  },
  { group: "Administration", label: "Audit Log", href: "/audit", permission: "audit.read" },
  { group: "Administration", label: "Email", href: "/emails", permission: "messages.read" },
  { group: "Administration", label: "Page Views", href: "/analytics", permission: "superadmin" },
];

export function navigationFor(principal: Principal): NavItem[] {
  if (!canAccessAdmin(principal)) return [];
  return ADMIN_NAVIGATION.filter(
    (entry) =>
      entry.permission === null ||
      (entry.permission === "superadmin"
        ? isSuperadmin(principal)
        : canInSomeScope(principal, entry.permission)),
  ).map(({ group, label, href }) => ({ group, label, href }));
}
