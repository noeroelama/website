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

  it("content wraps onto the next line instead of overflowing the table", () => {
    const cells = ruleFor(".admin-table td")
      .map((rule) => rule.body)
      .join("");
    expect(cells).toMatch(/overflow-wrap:\s*break-word/);
    // Links and e-mails (the line under a title) have no spaces, so they may break anywhere.
    expect(
      ruleFor(".admin-table__sub")
        .map((rule) => rule.body)
        .join(""),
    ).toMatch(/overflow-wrap:\s*anywhere/);
    for (const rule of adminRules.filter((r) => /\.admin-table(?!-)/.test(r.selector))) {
      expect(rule.body, rule.selector).not.toMatch(
        /white-space:\s*nowrap|text-overflow|min-width:\s*[1-9]/,
      );
    }
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

describe("admin tabs", () => {
  const tabRules = adminRules.filter((rule) => /\.admin-tabs(?![_-])/.test(rule.selector));
  const base = tabRules.find((rule) => rule.selector === ".admin-tabs")?.body ?? "";

  it("scroll sideways without a scrollbar and keep their items inside the tab height", () => {
    expect(base).toMatch(/overflow-x:\s*auto/);
    expect(base).toMatch(/overflow-y:\s*hidden/);
    expect(base).toMatch(/scrollbar-width:\s*none/);
    expect(adminRules.some((r) => r.selector === ".admin-tabs::-webkit-scrollbar")).toBe(true);
    // One place decides the scrolling: page-specific tab rules must not change it.
    for (const rule of tabRules.filter((r) => r.selector !== ".admin-tabs")) {
      expect(rule.body, rule.selector).not.toMatch(/overflow/);
    }
    // The active underline sits inside the tab row (a line below it would need vertical scroll).
    for (const rule of adminRules.filter((r) => r.selector.includes(".admin-tabs__btn::after"))) {
      expect(rule.body, rule.selector).not.toMatch(/bottom:\s*(-|calc\(-)/);
    }
  });

  it("fade into the background at the end", () => {
    expect(base).toMatch(/mask-image:\s*linear-gradient\(\s*to right/);
  });

  it("every tab row is the shared Tabs component, which scrolls when dragged with the mouse", () => {
    const admin = join(ROOT, "apps/admin/src");
    const controls = readFileSync(join(admin, "components/ui/list-controls.tsx"), "utf8");
    expect(controls).toMatch(/className="admin-tabs"[\s\S]*onPointerDown=/);
    const tablists = files("apps/admin/src", [".tsx"]).filter((path) =>
      readFileSync(join(ROOT, path), "utf8").includes('role="tablist"'),
    );
    expect(tablists.map((path) => path.replaceAll("\\", "/"))).toEqual([
      "apps/admin/src/components/ui/list-controls.tsx",
    ]);
  });
});

describe("admin scrollbar", () => {
  const bodyOf = (selector: string) =>
    adminRules
      .filter((rule) => rule.selector === selector)
      .map((rule) => rule.body)
      .join("");

  it("reserves its gutter, so content keeps its width when a page becomes scrollable", () => {
    expect(bodyOf("html:has(.admin-dark-page)")).toMatch(/scrollbar-gutter:\s*stable/);
  });

  it("is the same slim rounded thumb on every scroll area, not only the page (Firefox gets the standard properties)", () => {
    const bar = "*::-webkit-scrollbar";
    expect(bodyOf(bar)).toMatch(/width:\s*[\d.]+(px|rem)/);
    expect(bodyOf(`${bar}-track`)).toMatch(/background:\s*transparent/);
    expect(bodyOf(`${bar}-thumb`)).toMatch(/border-radius:\s*var\(--radius-full\)/);
    expect(bodyOf("*")).toMatch(/scrollbar-color:[^;]*transparent/);
  });
});

describe("admin tables on a phone", () => {
  // The phone rules sit between two markers, in one @media block, at the end of the stylesheet.
  const source = readFileSync(join(ROOT, "apps/admin/src/app/globals.css"), "utf8");
  const [, afterBegin = ""] = source.split("/* Mobile list cards: begin */");
  const [block = ""] = afterBegin.split("/* Mobile list cards: end */");
  const rules = [...block.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    ([, selector, body]) => ({
      selector: (selector ?? "").replace(/@media[^{]*$/, "").trim(),
      body: body ?? "",
    }),
  );
  const bodyOf = (selector: string) =>
    rules
      .filter((rule) => rule.selector.split(/,\s*/).includes(selector))
      .map((rule) => rule.body)
      .join("");

  it("applies only up to the phone width", () => {
    expect(block).toMatch(/@media \(max-width: 767px\)/);
  });

  it("a row is a cream card and the header row is hidden (sorting moves to the summary line)", () => {
    const card = bodyOf(".admin-dark-page .admin-table tbody tr");
    expect(card).toMatch(/display:\s*grid/);
    expect(card).toMatch(/background:\s*var\(--color-brand-50\)/);
    expect(card).toMatch(/border-radius:\s*var\(--radius-/);
    expect(bodyOf(".admin-dark-page .admin-table thead")).toMatch(/display:\s*none/);
  });

  it("the cream card flips the surface colours like every other cream surface", () => {
    // Only on a phone: on a wide screen the same rows are dark, so the flip stays in this block.
    const card = bodyOf(".admin-dark-page .admin-table tbody tr");
    for (const flipped of [
      /--admin-ink:\s*var\(--color-brand-950\)/,
      /--admin-btn-bg:\s*var\(--color-brand-950\)/,
      /--admin-field-bg:\s*var\(--color-brand-950\)/,
    ]) {
      expect(card).toMatch(flipped);
    }
  });

  it("phone-only parts are hidden on a wide screen and shown in the phone block", () => {
    for (const selector of [".admin-sort-menu", ".admin-row-menu__item--phone"]) {
      const wide = adminRules.filter((rule) => rule.selector.split(/,\s*/).includes(selector));
      expect(wide.map((rule) => rule.body).join(""), selector).toMatch(/display:\s*none/);
      expect(bodyOf(selector), selector).toMatch(/display:/);
    }
    // Long button words ("Delete Event", "Copy Link") shrink to the design's "Delete", "Copy".
    expect(bodyOf(".admin-long")).toMatch(/display:\s*none/);
  });

  it("an event card follows the design: pills side by side, one 'last modified' line, no labels", () => {
    expect(bodyOf(".admin-dark-page .admin-table .admin-event-meta")).toMatch(/row-reverse/);
    const status = bodyOf(
      ".admin-dark-page .admin-table tr:has(.admin-event-title) td:has(> .admin-status-badge)",
    );
    expect(status).toMatch(/grid-row:\s*2/);
  });

  it("the Add / Export buttons float at the bottom right and the bulk bar sticks to the bottom", () => {
    expect(bodyOf(".admin-fab")).toMatch(/position:\s*fixed/);
    expect(bodyOf(".admin-dark-page .admin-list-card .admin-bulkbar")).toMatch(/position:\s*fixed/);
    // Outside the phone block the wrapper does not exist as a box.
    expect(
      adminRules
        .filter((rule) => rule.selector === ".admin-fab")
        .map((rule) => rule.body)
        .join(""),
    ).toMatch(/display:\s*contents/);
  });
});
