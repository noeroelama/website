import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizePermissions,
  resolveAssignments,
  SUPERADMIN_ROLE_ID,
  type Principal,
  type Scope,
} from "@website/permissions";
import { ADMIN_NAVIGATION, navigationFor } from "../../apps/admin/src/navigation";

const roles = new Map(
  [
    {
      id: "viewer",
      name: "Viewer",
      permissions: normalizePermissions(["events.read", "gallery.read", "articles.read"]),
    },
    {
      id: "editor",
      name: "Editor",
      permissions: normalizePermissions([
        "events.edit",
        "gallery.edit",
        "articles.publish",
        "newsletter.edit",
      ]),
    },
    { id: "user_reader", name: "User reader", permissions: normalizePermissions(["users.read"]) },
    {
      id: "chapter_editor",
      name: "Chapter editor",
      permissions: normalizePermissions(["events.edit", "gallery.edit", "articles.edit"]),
    },
  ].map((role) => [role.id, role]),
);

const staff = (roleId: string, scope: Scope = { type: "global" }, active = true): Principal => ({
  kind: "user",
  userId: "u",
  active,
  assignments: resolveAssignments([{ roleId, scope }], roles),
});

const labels = (principal: Principal) => navigationFor(principal).map((item) => item.label);

describe("admin side panel navigation", () => {
  it("lists every page, in the designed order and groups, for a superadmin", () => {
    const groups = new Map<string, string[]>();
    for (const item of navigationFor(staff(SUPERADMIN_ROLE_ID))) {
      groups.set(item.group, [...(groups.get(item.group) ?? []), item.label]);
    }
    expect(Object.fromEntries(groups)).toEqual({
      Workspace: ["Dashboard", "My Tasks", "Calendar", "Tools"],
      Content: ["Event", "Gallery", "Article", "Newsletter", "Forms"],
      Organization: ["Recruitment", "Letter", "Organizations"],
      Planning: ["OKR", "Programmes", "LPJ", "Finance", "Meetings", "Zoom"],
      Administration: ["Role Manager", "Audit Log", "Email"],
    });
  });

  it("keeps each group's pages together (the side panel starts a group when it changes)", () => {
    const order = ADMIN_NAVIGATION.map((entry) => entry.group).filter(
      (group, i, all) => group !== all[i - 1],
    );
    expect(new Set(order).size).toBe(order.length);
  });

  it("shows only the pages a role may open", () => {
    expect(labels(staff("viewer"))).toEqual([
      "Dashboard",
      "My Tasks",
      "Event",
      "Gallery",
      "Article",
    ]);
    expect(labels(staff("editor"))).toEqual([
      "Dashboard",
      "My Tasks",
      "Event",
      "Gallery",
      "Article",
      "Newsletter",
    ]);
  });

  it("opens Role Manager (people and roles in one page) with users.read", () => {
    expect(labels(staff("user_reader"))).toEqual(["Dashboard", "My Tasks", "Role Manager"]);
  });

  it("counts chapter-scoped roles (their pages filter data to the chapter)", () => {
    expect(labels(staff("chapter_editor", { type: "chapter", chapterId: "jp" }))).toEqual([
      "Dashboard",
      "My Tasks",
      "Event",
      "Gallery",
      "Article",
    ]);
  });

  it("shows nothing to members, customers and inactive accounts", () => {
    expect(navigationFor(staff("visitor"))).toEqual([]);
    expect(navigationFor(staff(SUPERADMIN_ROLE_ID, { type: "global" }, false))).toEqual([]);
  });

  it("never sends permission names to the browser, only group, label and href", () => {
    for (const item of navigationFor(staff(SUPERADMIN_ROLE_ID))) {
      expect(Object.keys(item).sort()).toEqual(["group", "href", "label"]);
    }
  });

  it("has unique internal links", () => {
    const hrefs = ADMIN_NAVIGATION.map((entry) => entry.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) expect(href.startsWith("/")).toBe(true);
  });

  it("gives every entry a page that checks the session and the entry's permission", () => {
    const panel = join(import.meta.dirname, "../../apps/admin/src/app/(panel)");
    for (const { href, permission } of ADMIN_NAVIGATION) {
      const source = readFileSync(join(panel, href, "page.tsx"), "utf8");
      expect(source, href).toContain("export const instant = false;");
      expect(source, href).toContain(
        permission === null
          ? `requireAdminViewer("${href}")`
          : `requireAdminViewer("${href}", "${permission}")`,
      );
    }
  });
});

describe("dashboard page views and setup check", () => {
  it("live on the Dashboard (no separate page) and are loaded only for a superadmin", () => {
    const panel = join(import.meta.dirname, "../../apps/admin/src/app/(panel)");
    expect(existsSync(join(panel, "analytics"))).toBe(false);
    expect(existsSync(join(panel, "settings"))).toBe(false);
    const source = readFileSync(join(panel, "page.tsx"), "utf8");
    expect(source).toMatch(/const superadmin = isSuperadmin\(viewer\.principal\);/);
    expect(source).toMatch(/superadmin\s*\?\s*await pageViewReport\(/);
    expect(source).toMatch(/superadmin \? integrationStatus\(/);
  });
});

describe("side-panel logo", () => {
  it("links to the public website (WEB_URL)", () => {
    const admin = join(import.meta.dirname, "../../apps/admin/src");
    const layout = readFileSync(join(admin, "app/(panel)/layout.tsx"), "utf8");
    const sidebar = readFileSync(join(admin, "components/admin-sidebar.tsx"), "utf8");
    expect(layout).toContain("webUrl={getAppUrls().WEB_URL}");
    expect(sidebar).toMatch(/<a href=\{props\.webUrl\}[^>]*>\s*\{logo\}\s*<\/a>/);
  });
});
