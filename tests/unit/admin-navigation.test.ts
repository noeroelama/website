import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizePermissions,
  resolveAssignments,
  SUPERADMIN_ROLE_ID,
  type Principal,
  type Scope,
} from "@website/permissions";
import { ADMIN_NAVIGATION, initials, navigationFor } from "../../apps/admin/src/navigation";

// Custom roles as created in the admin Roles page.
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
  it("lists every page, in the designed order, for a superadmin", () => {
    expect(labels(staff(SUPERADMIN_ROLE_ID))).toEqual([
      "Dashboard",
      "Tools",
      "Event",
      "Gallery",
      "Article",
      "Newsletter",
      "Organizations",
      "Universities",
      "Members",
      "Users",
      "Roles",
      "Audit Log",
      "Messages",
    ]);
  });

  it("shows only the pages a role may open", () => {
    expect(labels(staff("viewer"))).toEqual(["Dashboard", "Event", "Gallery", "Article"]);
    expect(labels(staff("editor"))).toEqual([
      "Dashboard",
      "Event",
      "Gallery",
      "Article",
      "Newsletter",
    ]);
  });

  it("counts chapter-scoped roles (their pages filter data to the chapter)", () => {
    expect(labels(staff("chapter_editor", { type: "chapter", chapterId: "jp" }))).toEqual([
      "Dashboard",
      "Event",
      "Gallery",
      "Article",
    ]);
  });

  it("shows nothing to members, customers and inactive accounts", () => {
    expect(navigationFor(staff("member"))).toEqual([]);
    expect(navigationFor(staff("user"))).toEqual([]);
    expect(navigationFor(staff(SUPERADMIN_ROLE_ID, { type: "global" }, false))).toEqual([]);
  });

  it("never sends permission names to the browser, only label and href", () => {
    for (const item of navigationFor(staff(SUPERADMIN_ROLE_ID))) {
      expect(Object.keys(item).sort()).toEqual(["href", "label"]);
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

describe("avatar initials", () => {
  it("uses the first and last name", () => {
    expect(initials("Nevyllo Zamuel Kalangi")).toBe("NK");
    expect(initials("  ari   wibowo ")).toBe("AW");
  });

  it("falls back to two letters of a single word, or '?' when empty", () => {
    expect(initials("nevyllokalangi")).toBe("NE");
    expect(initials("A")).toBe("A");
    expect(initials("   ")).toBe("?");
  });
});
