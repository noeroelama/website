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
    for (const hex of ["#1f0006", "#3a000c", "#a8173a", "#e6b15a", "#ecd7d6", "#fcf4f3"]) {
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
    for (const rule of tabRules.filter((r) => r.selector !== ".admin-tabs")) {
      expect(rule.body, rule.selector).not.toMatch(/overflow/);
    }
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
    expect(bodyOf(".admin-long")).toMatch(/display:\s*none/);
  });

  it("an event card follows the design: pills side by side, one 'last modified' line, no labels", () => {
    expect(bodyOf(".admin-dark-page .admin-table .admin-event-meta")).toMatch(/row-reverse/);
    const status = bodyOf(
      ".admin-dark-page .admin-table tr:has(.admin-event-title) td:has(> .admin-status-badge)",
    );
    expect(status).toMatch(/grid-row:\s*2/);
  });

  it("a card is readable and thumb-friendly: no micro text, 44 px targets, selection shows", () => {
    expect(block).not.toMatch(/--text-2xs/);
    const button = rules
      .filter((rule) =>
        rule.selector
          .replace(/\s+/g, " ")
          .endsWith('td[data-card="actions"] :is(.admin-row-menu__item, .admin-btn--icon)'),
      )
      .map((rule) => rule.body)
      .join("");
    expect(button).toMatch(/min-height:\s*var\(--size-touch\)/);
    expect(bodyOf('.admin-dark-page .admin-table td[data-card="lead"] .admin-checkbox')).toMatch(
      /width:\s*var\(--size-touch\)/,
    );
    expect(bodyOf(".admin-list-summary__btn")).toMatch(/min-height:\s*var\(--size-touch\)/);
    expect(bodyOf('.admin-dark-page .admin-table td[data-card="actions"]')).toMatch(
      /grid-auto-columns:\s*minmax\(0,\s*1fr\)/,
    );
    expect(
      bodyOf(".admin-dark-page .admin-table tbody tr:has(.admin-table__checkbox:checked)"),
    ).toMatch(/box-shadow:/);
  });

  it("the Add / Export buttons float at the bottom right and the bulk bar sticks to the bottom", () => {
    expect(bodyOf(".admin-fab")).toMatch(/position:\s*fixed/);
    expect(bodyOf(".admin-dark-page .admin-list-card .admin-bulkbar")).toMatch(/position:\s*fixed/);
    expect(
      adminRules
        .filter((rule) => rule.selector === ".admin-fab")
        .map((rule) => rule.body)
        .join(""),
    ).toMatch(/display:\s*contents/);
  });
});

describe("admin side panel", () => {
  const body = (selector: string) =>
    adminRules
      .filter((rule) => rule.selector.split(/,\s*/).includes(selector))
      .map((rule) => rule.body)
      .join("");

  it("scrolls only the page menu; the logo and the account stay in place", () => {
    expect(body(".admin-panel")).not.toMatch(/overflow(-y)?:\s*auto/);
    expect(body(".admin-panel")).toMatch(/overflow:\s*hidden/);
    expect(body(".admin-nav")).toMatch(/overflow-y:\s*auto/);
    expect(body(".admin-nav")).toMatch(/min-height:\s*0/);
    expect(body(".admin-nav")).toMatch(/flex:\s*1/);
  });

  it("puts 8px between pages and 12px between menu groups", () => {
    expect(body(".admin-nav-list")).toMatch(/gap:\s*var\(--space-2\)/);
    expect(body(".admin-nav")).toMatch(/gap:\s*var\(--space-3\)/);
    const sidebar = readFileSync(join(ROOT, "apps/admin/src/components/admin-sidebar.tsx"), "utf8");
    expect(sidebar).toMatch(/groups\.map\([\s\S]*className="admin-menu-label"/);
  });

  it("puts the menu's scrollbar on the very right edge of the panel", () => {
    expect(body(".admin-nav")).toMatch(/margin-inline:\s*calc\(-1 \* var\(--space-3-5\)\)/);
    expect(body(".admin-nav")).toMatch(/padding-inline:\s*var\(--space-3-5\)/);
    expect(body(".admin-panel")).toMatch(/padding:[^;]*var\(--space-3-5\)/);
  });

  it("lets each menu group collapse (open by default)", () => {
    const sidebar = readFileSync(join(ROOT, "apps/admin/src/components/admin-sidebar.tsx"), "utf8");
    expect(sidebar).toMatch(
      /<details[^>]*\bopen\b[\s\S]*?<summary[^>]*className="admin-menu-label"/,
    );
    expect(body(".admin-menu-label::-webkit-details-marker")).toMatch(/display:\s*none/);
  });
});

describe("admin text", () => {
  it("shows no workflow guides", () => {
    for (const path of files("apps/admin/src", [".ts", ".tsx"])) {
      expect(readFileSync(join(ROOT, path), "utf8"), path).not.toMatch(/WorkflowGuide|WORKFLOWS/);
    }
    expect(styleSources.some((path) => path.includes("workflow-guide"))).toBe(false);
    expect(tokens).not.toContain("ui-workflow");
  });

  it("has no emoji (icons come from ui/icon.tsx)", () => {
    const emoji = /\p{Extended_Pictographic}|[\u2605\u2713\u2714\u2717\u2718]/u;
    for (const path of files("apps/admin/src", [".ts", ".tsx", ".css"])) {
      const lines = readFileSync(join(ROOT, path), "utf8").split("\n");
      lines.forEach((line, i) => expect(line, `${path}:${i + 1}`).not.toMatch(emoji));
    }
  });
});

describe("admin controls", () => {
  const adminCss = readFileSync(join(ROOT, "apps/admin/src/app/globals.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const controlRules = adminRules.filter(
    (rule) =>
      /\.admin-(btn|input|select|searchbox|url-slug|filters-btn|filter-panel__clear)(?![\w-])|\.admin-btn--(sm|lg)\b/.test(
        rule.selector,
      ) && !/admin-btn--icon|admin-editor|admin-darkbar|::/.test(rule.selector),
  );

  it("buttons, fields, dropdowns and the search box share one height", () => {
    expect(adminCss).toMatch(
      /:root\s*\{[^}]*--admin-control-height:\s*calc\(var\(--size-control-sm\) \+ var\(--space-1-5\)\)/,
    );
    expect(adminCss).toMatch(
      /@media \(max-width: 767px\)\s*\{\s*:root\s*\{\s*--admin-control-height:\s*var\(--size-control\);/,
    );
    const height = (selector: string) =>
      adminRules
        .filter((rule) => rule.selector.split(/,\s*/).includes(selector))
        .map((rule) => rule.body)
        .join("");
    expect(height(".admin-btn")).toMatch(/min-height:\s*var\(--admin-control-height\)/);
    expect(height(".admin-input")).toMatch(/(^|[^-])height:\s*var\(--admin-control-height\)/);
    expect(height(".admin-select")).toMatch(/(^|[^-])height:\s*var\(--admin-control-height\)/);
    expect(height(".admin-searchbox")).toMatch(/(^|[^-])height:\s*var\(--admin-control-height\)/);
    expect(height(".admin-url-slug")).toMatch(/(^|[^-])height:\s*var\(--admin-control-height\)/);
    for (const rule of controlRules) {
      for (const [declaration] of rule.body.matchAll(/(?:^|;|\s)(?:min-)?height:\s*[^;]+/g)) {
        expect(declaration, rule.selector).toMatch(/var\(--admin-control-height\)|100%|auto/);
      }
    }
  });
});

describe("admin motion and overflow (UI/UX rules)", () => {
  const css = readFileSync(join(ROOT, "apps/admin/src/app/globals.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const body = (selector: string) =>
    adminRules
      .filter((rule) => rule.selector.split(/,\s*/).includes(selector))
      .map((rule) => rule.body)
      .join("");
  const source = (path: string) => readFileSync(join(ROOT, "apps/admin/src", path), "utf8");

  it("defines the spring easing once", () => {
    expect(css).toMatch(
      /--admin-ease-spring:\s*linear\(\s*0,\s*0\.55 10%,\s*1\.12 30%,\s*0\.98 55%,\s*1\.01 75%,\s*1\s*\)/,
    );
  });

  it("presses a button with the spring; buttons have no inset lines, shadow or glow", () => {
    const button = body(".admin-btn");
    expect(button).toMatch(/scale 0\.6s var\(--admin-ease-spring\)/);
    expect(body(".admin-btn:active:not(:disabled)")).toMatch(/scale:/);
    for (const rule of adminRules.filter((r) =>
      /\.admin-btn(?![\w-])|\.admin-btn--/.test(r.selector),
    )) {
      expect(rule.body, rule.selector).not.toMatch(
        /box-shadow:\s*(?!none)[^;]*inset|--admin-btn-glow/,
      );
    }
    expect(css).not.toContain("--admin-btn-glow");
  });

  it("stops a popup's scrolling at its edge", () => {
    for (const rule of adminRules.filter((r) => /overflow(-y)?:\s*auto/.test(r.body))) {
      expect(rule.body, rule.selector).toMatch(/overscroll-behavior:\s*contain/);
    }
  });

  it("lets every popup glide in from opacity 0 and scale 0.9", () => {
    const start = /@starting-style\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    for (const popup of [
      ".admin-modal",
      ".admin-row-menu__panel",
      ".admin-popup",
      ".admin-link-pop",
    ]) {
      expect(start, popup).toContain(popup);
    }
    expect(start).toMatch(/opacity:\s*0/);
    expect(start).toMatch(/scale:\s*0\.9/);
  });

  it("turns a dropdown's arrow when it opens and presses it like a button", () => {
    const turn = adminRules.find((r) => /\[aria-expanded="true"\]\s*>\s*svg/.test(r.selector));
    expect(turn?.selector).toContain(".admin-combo__trigger");
    expect(turn?.body).toMatch(/rotate:\s*180deg/);
    const press = adminRules.find(
      (r) => /\.admin-combo__trigger[\s\S]*:active/.test(r.selector) && /scale:/.test(r.body),
    );
    expect(press?.body).toMatch(/scale:\s*0\.96/);
    expect(
      adminRules.some(
        (r) =>
          r.selector.includes(".admin-combo__trigger") &&
          /transition:[^;]*scale[^;]*admin-ease-spring/.test(r.body),
      ),
    ).toBe(true);
    expect(source("components/ui/select.tsx")).not.toMatch(/transformOrigin|--admin-drop/);
  });

  it("shows a dark scrollbar thumb in cream menus, also when the menu itself scrolls", () => {
    const thumb = adminRules.find(
      (r) =>
        r.selector.includes(".admin-row-menu__panel") &&
        /::-webkit-scrollbar-thumb$/.test(r.selector),
    );
    expect(thumb?.selector).toMatch(/\.admin-row-menu__panel,\s*\.admin-row-menu__panel \*/);
    expect(thumb?.body).toMatch(/background:[^;]*brand-950/);
  });

  it("fades the old page into the new one on navigation (sidebar stays still)", () => {
    const sidebar = source("components/admin-sidebar.tsx");
    expect(sidebar).toMatch(/import \{[^}]*\bViewTransition\b[^}]*\} from "react"/);
    expect(sidebar).toMatch(
      /<ViewTransition>\s*<main id="main"[\s\S]*?<\/main>\s*<\/ViewTransition>/,
    );
    expect(css).toMatch(
      /prefers-reduced-motion: reduce\)\s*\{[\s\S]*?::view-transition-group\(\*\)[\s\S]*?animation:\s*none/,
    );
  });

  it("delays each menu, list and table row by its index", () => {
    expect(css).toMatch(/animation-delay:\s*calc\(min\(var\(--i, 0\), \d+\) \* 40ms\)/);
    for (const path of [
      "components/ui/select.tsx",
      "components/ui/list-controls.tsx",
      "components/ui/data-table.tsx",
      "components/admin-sidebar.tsx",
    ]) {
      expect(source(path), path).toMatch(/"--i": /);
    }
  });

  it("grows a note field a line at a time with a soft spring", () => {
    expect(body("textarea")).toMatch(/transition:[^;]*height[^;]*var\(--admin-ease-spring\)/);
    expect(source("components/admin-sidebar.tsx")).toMatch(
      /HTMLTextAreaElement[\s\S]*scrollHeight/,
    );
  });

  it("lets every growing flex item shrink below its content (min-width: 0)", () => {
    for (const rule of adminRules.filter((r) =>
      /(^|[;\s])(flex:\s*[1-9]|flex-grow:\s*[1-9])/.test(r.body),
    )) {
      expect(rule.body, rule.selector).toMatch(/min-width:/);
    }
  });

  it("breaks long words anywhere on a phone", () => {
    expect(css).toMatch(
      /@media \(max-width: 767px\)\s*\{\s*body,[^{]*\{\s*overflow-wrap:\s*anywhere;/,
    );
  });
});

describe("admin buttons, forms, gaps and corners (UI/UX rules)", () => {
  const css = readFileSync(join(ROOT, "apps/admin/src/app/globals.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const tsx = files("apps/admin/src", [".tsx"]).map((path) => ({
    path,
    source: readFileSync(join(ROOT, path), "utf8").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/[^\n]*/gm, ""),
  }));
  const body = (selector: string) =>
    adminRules
      .filter((rule) => rule.selector.split(/,\s*/).includes(selector))
      .map((rule) => rule.body)
      .join("");

  it("uses real buttons: every <button> has a type, nothing pretends to be one", () => {
    for (const { path, source } of tsx) {
      for (const match of source.matchAll(/<button\b([^>]*?)>/gs)) {
        expect(match[1], path).toMatch(/\btype=/);
      }
      expect(source, path).not.toContain('role="button"');
    }
    const button = readFileSync(join(ROOT, "apps/admin/src/components/ui/button.tsx"), "utf8");
    expect(button).toContain('type = "button"');
    expect(button).toContain("aria-busy={busy || undefined}");
    expect(button).toContain("reportValidity()");
  });

  it("styles the six button states; hover only on devices that can hover", () => {
    expect(body(".admin-btn")).toMatch(/min-height/);
    expect(body(".admin-btn:focus-visible")).toMatch(/outline:/);
    expect(body(".admin-btn:active:not(:disabled)")).toMatch(/scale:/);
    expect(body('.admin-btn[aria-busy="true"]')).toMatch(/cursor:\s*progress/);
    expect(body('.admin-btn[aria-busy="true"]::after')).toMatch(/animation:/);
    expect(body(".admin-btn:disabled")).toMatch(/cursor:\s*not-allowed/);
    const outsideHover = css.replace(/@media \(hover: hover\)\s*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, "");
    expect(outsideHover).not.toMatch(/\.admin-btn[^{},]*:hover/);
  });

  it("puts every editor in a <form> whose action button submits (native validation)", () => {
    const editors = [
      "articles-page.tsx",
      "events-page.tsx",
      "finance-page.tsx",
      "forms-page.tsx",
      "gallery-page.tsx",
      "incoming-page.tsx",
      "letter-types-page.tsx",
      "letters-page.tsx",
      "newsletter-page.tsx",
      "recruitment-page.tsx",
      "participants-page.tsx",
      "certificate-send-panel.tsx",
    ];
    for (const name of editors) {
      const source = readFileSync(join(ROOT, "apps/admin/src/components", name), "utf8");
      expect(source, name).toMatch(/<form\b/);
      expect(source, name).toMatch(/<Button\s+type="submit"/);
    }
    for (const { path, source } of tsx) {
      if (!/type="submit"/.test(source)) continue;
      expect(source, path).toMatch(/<form\b|\basForm\b|\bform="/);
    }
  });

  it("connects a label to every field", () => {
    for (const { path, source } of tsx) {
      for (const match of source.matchAll(
        /<(input|textarea|Select)\b((?:=>|[^<>=]|=(?!>)|\{(?:=>|[^{}]|\{[^{}]*\})*\})*?)\/?>/gs,
      )) {
        const attrs = match[2] ?? "";
        if (/type="(hidden|file)"|\shidden\b/.test(attrs)) continue;
        const before = source.slice(Math.max(0, (match.index ?? 0) - 600), match.index);
        const insideLabel = before.lastIndexOf("<label") > before.lastIndexOf("</label>");
        expect(
          /\bid=|aria-label/.test(attrs) || insideLabel,
          `${path}: ${attrs.slice(0, 60)}`,
        ).toBe(true);
      }
    }
  });

  it("spaces with space(step) = step × 0.25rem", () => {
    for (const [, name = "", value] of tokens.matchAll(/--space-([\d-]+):\s*([\d.]+)rem;/g)) {
      expect(Number(value), `--space-${name}`).toBeCloseTo(Number(name.replace("-", ".")) * 0.25);
    }
    for (const [, value = ""] of css.matchAll(
      /(?<![\w-])(?:gap|row-gap|column-gap):\s*([^;]+);/g,
    )) {
      expect(value.trim()).toMatch(/^(0|var\(--space-[\d-]+\))( var\(--space-[\d-]+\))?$/);
    }
  });

  it("nests corners: outer radius = inner radius + gap", () => {
    expect(body(".admin-row-menu__panel")).toMatch(
      /padding:\s*var\(--space-1\)[\s\S]*border-radius:\s*calc\(var\(--radius-sm\) \+ var\(--space-1\)\)/,
    );
    expect(body(".admin-row-menu__item")).toMatch(/border-radius:\s*var\(--radius-sm\)/);
  });
});

describe("admin tabs and table columns", () => {
  const adminSources = files("apps/admin/src", [".ts", ".tsx"]).map((path) => ({
    path,
    source: readFileSync(join(ROOT, path), "utf8"),
  }));

  it("keeps a tab the same width on hover (only its colour changes)", () => {
    for (const rule of adminRules.filter((r) => /\.admin-tabs__btn[^,]*:hover/.test(r.selector))) {
      expect(rule.body, rule.selector).not.toMatch(/font-weight|padding|letter-spacing|font-size/);
    }
  });

  it("filters and sorts from each sortable column; no Filters button anywhere", () => {
    for (const { path, source } of adminSources) {
      expect(source, path).not.toMatch(/FiltersButton|admin-filter-panel|admin-filters-btn/);
    }
    const menu = readFileSync(join(ROOT, "apps/admin/src/components/ui/column-menu.tsx"), "utf8");
    expect(menu).toContain('name="filter"');
    expect(menu).toMatch(/onSort\("asc"\)[\s\S]*onSort\("desc"\)/);
    expect(menu).toMatch(/type="checkbox"/);
    for (const { path, source } of adminSources) {
      if (path.replaceAll("\\", "/").endsWith("components/ui/list-controls.tsx")) continue;
      if (path.replaceAll("\\", "/").endsWith("components/ui/data-table.tsx")) continue;
      expect(source, path).not.toMatch(/<SortHeader\b/);
    }
  });

  it("makes each Audit Log picker one button as tall as the other controls, ringed only from the keyboard", () => {
    const audit = readFileSync(join(ROOT, "apps/admin/src/components/audit-page.tsx"), "utf8");
    expect(audit).not.toMatch(/<label className="admin-audit-pick"/);
    expect(audit.match(/<Select\s+className="admin-audit-pick"/g)).toHaveLength(3);
    const pick = adminRules.filter((r) => /\.admin-audit-pick\b/.test(r.selector));
    expect(pick.find((r) => r.selector === ".admin-audit-pick")?.body).toMatch(
      /height:\s*var\(--admin-control-height\)/,
    );
    expect(pick.map((r) => r.selector).join(" ")).not.toMatch(/:focus-within/);
  });

  it("shows every Publish button and menu item as the minimal globe with the word Publish", () => {
    let count = 0;
    for (const { path, source } of adminSources) {
      expect(source, path).not.toMatch(/aria-label="Publish"|admin-btn--square/);
      const labels = source.match(/>\s*Publish\s*<\//g) ?? [];
      const icons = [...source.matchAll(/icon="(\w+)"[^<]*?>\s*Publish\s*<\//g)].map((m) => m[1]);
      expect(icons, path).toHaveLength(labels.length);
      for (const icon of icons) expect(icon, path).toBe("globeSimple");
      count += labels.length;
    }
    expect(count).toBeGreaterThanOrEqual(13);
  });

  it("opens a dropdown above its button when there is no room below (Rows per page)", () => {
    const panel = adminRules.filter((r) => r.selector === ".admin-combo__panel");
    expect(panel.map((r) => r.body).join("")).toMatch(/top:\s*auto/);
  });

  it("draws a line above the table's paging bar, once", () => {
    const bar = adminRules
      .filter((r) => r.selector === ".admin-dark-page .admin-darkbar")
      .map((r) => r.body)
      .join("");
    expect(bar).toMatch(/border-top:\s*1px solid var\(--color-panel-line\)/);
    expect(bar).not.toMatch(/border-top:\s*0/);
    const last = adminRules.find((r) =>
      r.selector.includes(".admin-dark-page .admin-table tbody tr:last-child td"),
    );
    expect(last?.body).toMatch(/border-bottom:\s*0/);
  });

  it("has one rows-per-page list (10, 25, 50)", () => {
    const lists = adminSources.filter(({ source }) => /PAGE_SIZE_OPTIONS = \[/.test(source));
    expect(lists.map(({ path }) => path.replaceAll("\\", "/"))).toEqual([
      "apps/admin/src/components/list-model.ts",
    ]);
  });
});
