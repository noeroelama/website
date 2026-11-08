import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  axisTicks,
  pageOptions,
  pointLabel,
} from "../../apps/admin/src/components/page-views-model";

describe("page views chart (Dashboard)", () => {
  it("steps the views axis in round numbers from 0 to just above the highest day", () => {
    expect(axisTicks(110)).toEqual([0, 20, 40, 60, 80, 100, 120]);
    expect(axisTicks(1_699)).toEqual([0, 500, 1_000, 1_500, 2_000]);
    expect(axisTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(axisTicks(0)).toEqual([0, 1]); // no views yet: still an axis
  });

  it("names a day, a month and a year the short way", () => {
    expect(pointLabel("2026-10-11")).toBe("Oct 11");
    expect(pointLabel("2026-11")).toBe("Nov 2026");
    expect(pointLabel("2026")).toBe("2026");
  });

  it("offers all pages, then each page viewed in the period, and keeps the chosen one", () => {
    const pages = [{ page: "/news" }, { page: "/" }];
    expect(pageOptions(pages, "*")).toEqual([
      { value: "*", label: "All pages" },
      { value: "/news", label: "/news" },
      { value: "/", label: "/" },
    ]);
    // A page with no views in this period is still listed while it is chosen.
    expect(pageOptions(pages, "/events").map((o) => o.value)).toEqual([
      "*",
      "/events",
      "/news",
      "/",
    ]);
  });

  it("puts the page dropdown left of the Daily / Monthly / Yearly switch in the card header", () => {
    const card = readFileSync(
      join(import.meta.dirname, "../../apps/admin/src/components/page-views-card.tsx"),
      "utf8",
    );
    expect(card).toMatch(/actions=\{\s*<PageViewsControls/);
    const controls = readFileSync(
      join(import.meta.dirname, "../../apps/admin/src/components/page-views-controls.tsx"),
      "utf8",
    );
    expect(controls.indexOf("<Select")).toBeLessThan(controls.indexOf('role="group"'));
    expect(controls).toMatch(/aria-current=\{[^}]*"page"/);
  });

  it("shows only the chart (no per-page table) with text on the admin type scale", () => {
    const admin = join(import.meta.dirname, "../../apps/admin/src");
    const card = readFileSync(join(admin, "components/page-views-card.tsx"), "utf8");
    expect(card).not.toMatch(/Each public page|No views in this period|<table/);
    // The chart draws at its real width, so 12 px text stays 12 px on every screen.
    const chart = readFileSync(join(admin, "components/page-views-chart.tsx"), "utf8");
    expect(chart).toMatch(/new ResizeObserver/);
    const css = readFileSync(join(admin, "app/globals.css"), "utf8");
    const rule = (selector: string) =>
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(
        css,
      )?.[1] ?? "";
    expect(rule(".admin-views__chart text")).toMatch(/font-size:\s*var\(--text-xs\)/);
    expect(rule(".admin-views__chart")).not.toMatch(/min-width/);
    // Card titles sit one step below the page title (Dashboard, text-3xl).
    expect(rule(".admin-dashboard .admin-card__title")).toMatch(/font-size:\s*var\(--text-xl\)/);
  });

  it("shows the date and views of the nearest point on hover, on a dashed guide line", () => {
    const admin = join(import.meta.dirname, "../../apps/admin/src");
    const chart = readFileSync(join(admin, "components/page-views-chart.tsx"), "utf8");
    expect(chart).toMatch(/onPointerMove=/);
    expect(chart).toMatch(/onPointerLeave=/);
    expect(chart).toContain('className="admin-views__guide"');
    expect(chart).toContain('className="admin-views__tip"');
    expect(chart).toMatch(/Views: \{/);
    expect(chart).not.toMatch(/<title>/); // the tooltip replaces the browser's own
  });

  it("makes each period tab as tall as the page dropdown; nothing under the totals", () => {
    const css = readFileSync(
      join(import.meta.dirname, "../../apps/admin/src/app/globals.css"),
      "utf8",
    );
    const tab = /a\.admin-segmented__item\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(tab).toMatch(/height:\s*var\(--admin-control-height\)/);
    const segmented = /\.admin-segmented\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(segmented).not.toMatch(/padding|border:/);
    const foot = /\.admin-views__foot\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(foot).toMatch(/margin:\s*var\(--space-2\) 0 0;/);
  });
});
