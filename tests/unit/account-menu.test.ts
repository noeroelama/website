import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initials, shortName } from "../../packages/ui/src/user-name";

const root = join(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");

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

describe("short name in the header", () => {
  it("keeps names of up to 16 characters", () => {
    expect(shortName("Ari Wibowo")).toBe("Ari Wibowo");
    expect(shortName("Sixteen chars ok")).toBe("Sixteen chars ok");
  });

  it("cuts longer names to 13 characters and three dots", () => {
    expect(shortName("Muhammad Muflih Naufal Kamil")).toBe("Muhammad Mufl...");
    expect(shortName("Seventeen chars!!")).toBe("Seventeen cha...");
  });
});

describe("admin account menu", () => {
  const sidebar = read("apps/admin/src/components/admin-sidebar.tsx");
  const panel = "apps/admin/src/app/(panel)";

  it("opens Profile and Account on the web app", () => {
    expect(sidebar).toContain('webPath("/account/profile")');
    expect(sidebar).toContain('webPath("/account")');
    for (const page of ["profile", "account"]) {
      expect(existsSync(join(root, panel, page)), page).toBe(false);
    }
  });

  it("has no Emails item (Email is in the side panel) and no extra separator line", () => {
    expect(sidebar).not.toMatch(/role="menuitem"[^>]*href="\/emails"/);
    expect(sidebar).not.toContain("MailIcon");
    expect(sidebar).not.toContain("admin-popup-separator");
  });

  it("merges Messages into the Email page", () => {
    expect(existsSync(join(root, panel, "messages"))).toBe(false);
    const page = read(`${panel}/emails/page.tsx`);
    expect(page).toContain("listFailedMessages");
    expect(page).toContain("RetryButton");
  });
});
