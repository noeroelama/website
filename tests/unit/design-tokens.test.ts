import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const TOKENS = "packages/ui/src/styles.css";
const tokens = readFileSync(join(ROOT, TOKENS), "utf8");

function files(dir: string, extensions: string[]): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return files(path, extensions);
    return extensions.some((ext) => name.endsWith(ext)) ? [path] : [];
  });
}

const styleSources = [
  ...["apps/web/src", "apps/admin/src", "apps/shop/src", "packages/ui/src"].flatMap((dir) =>
    files(dir, [".css", ".tsx"]),
  ),
].filter((path) => path.replaceAll("\\", "/") !== TOKENS);

describe("design tokens (one global stylesheet shared by every app)", () => {
  it("defines the brand palette", () => {
    for (const hex of ["#220709", "#551d22", "#a63232", "#e8d8cb", "#fbf3ec"]) {
      expect(tokens.toLowerCase()).toContain(hex);
    }
  });

  it("defines the Poppins type scale (size / line-height)", () => {
    const scale: Record<string, [string, string]> = {
      xs: ["0.75rem", "1.5"],
      sm: ["0.875rem", "1.5"],
      base: ["1rem", "1.5"],
      lg: ["1.125rem", "1.5"],
      xl: ["1.25rem", "1.4"],
      "2xl": ["1.5rem", "1.3"],
      "3xl": ["1.875rem", "1.2"],
      "4xl": ["2.25rem", "1.2"],
      "5xl": ["3rem", "1"],
      "6xl": ["3.75rem", "1"],
    };
    for (const [step, [size, leading]] of Object.entries(scale)) {
      expect(tokens).toContain(`--text-${step}: ${size};`);
      expect(tokens).toContain(`--leading-${step}: ${leading};`);
      expect(tokens).toMatch(new RegExp(`\\.text-${step}\\s*\\{`));
    }
    expect(tokens).toMatch(/--font-sans:\s*var\(--font-poppins\)/);
  });

  it("no app or component hardcodes colours", () => {
    for (const path of styleSources) {
      const source = readFileSync(join(ROOT, path), "utf8");
      expect(source, path).not.toMatch(/#[0-9a-f]{3,8}\b(?![\w-])/i);
      expect(source, path).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/i);
    }
  });

  it("CSS outside the token file takes colours, type, radius, spacing and shadows from tokens", () => {
    const tokenised =
      /^\s*(color|background(-color)?|border(-\w+)?-color|font-size|line-height|font-weight|font-family|letter-spacing|border-radius|padding(-\w+)?|margin(-\w+)?|gap|row-gap|column-gap|box-shadow|outline-offset)\s*:\s*(.+?);/gm;
    const allowed = /^(0|auto|none|inherit|transparent|currentColor|unset)$/;
    for (const path of styleSources.filter((p) => p.endsWith(".css"))) {
      const source = readFileSync(join(ROOT, path), "utf8");
      for (const match of source.matchAll(tokenised)) {
        const value = (match[match.length - 1] ?? "").trim();
        if (allowed.test(value) || value.includes("var(")) continue;
        throw new Error(`${path}: "${match[0].trim()}" must use a design token (var(--…))`);
      }
    }
  });
});

/** The admin stylesheet as { selector, body } rules (comments removed). */
const adminRules = [
  ...readFileSync(join(ROOT, "apps/admin/src/app/globals.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/([^{}]+)\{([^{}]*)\}/g),
].map(([, selector, body]) => ({ selector: (selector ?? "").trim(), body: body ?? "" }));

describe("admin popups", () => {
  const rules = adminRules;

  it("every popup sits in the middle of the page", () => {
    const overlay = rules.find((rule) => rule.selector === ".admin-modal-overlay");
    expect(overlay?.body).toMatch(/place-items:\s*center/);
    // No popup variant may move itself away from the centre the overlay gives it.
    for (const rule of rules.filter((r) => /\.admin-modal\b(?!-overlay)/.test(r.selector))) {
      expect(rule.body, rule.selector).not.toMatch(
        /(justify|align)-self\s*:|margin(-left|-right|-inline(-start|-end)?)?\s*:[^;]*auto/,
      );
    }
  });
});

describe("admin tables", () => {
  const ruleFor = (selector: string) =>
    adminRules.filter((rule) => rule.selector.split(/,\s*/).includes(selector));

  it("a table card fills the rest of the screen and grows with its rows", () => {
    // The content area and every wrapper down to the table card are columns…
    for (const selector of [
      ".admin-dark-page:has(.admin-list-card)",
      ".admin-dark-page :has(.admin-list-card)",
    ]) {
      const body = ruleFor(selector)
        .map((rule) => rule.body)
        .join("");
      expect(body, selector).toMatch(/display:\s*flex/);
      expect(body, selector).toMatch(/flex-direction:\s*column/);
    }
    // …that take the free height but never shrink below their rows (long tables scroll the page).
    for (const selector of [
      ".admin-dark-page :has(.admin-list-card)",
      ".admin-dark-page .admin-list-card",
      ".admin-dark-page .admin-list-card .admin-table-wrap",
    ]) {
      expect(
        ruleFor(selector)
          .map((rule) => rule.body)
          .join(""),
        selector,
      ).toMatch(/flex:\s*1 0 auto/);
    }
    // The height comes from the page itself, not from a guessed offset or blank filler rows.
    for (const rule of adminRules.filter((r) => r.selector.includes(".admin-list-card"))) {
      expect(rule.body, rule.selector).not.toMatch(/100dvh|100vh/);
    }
    expect(adminRules.some((rule) => rule.selector.includes("admin-table__placeholder"))).toBe(
      false,
    );
  });

  it("the no-results message sits in the middle of the table, under its header", () => {
    const body = ruleFor(".admin-table__empty")
      .map((rule) => rule.body)
      .join("");
    expect(body).toMatch(/flex:\s*1/);
    expect(body).toMatch(/place-items:\s*center/);
    expect(
      ruleFor(".admin-table-wrap--empty")
        .map((rule) => rule.body)
        .join(""),
    ).toMatch(/display:\s*flex/);
  });
});
