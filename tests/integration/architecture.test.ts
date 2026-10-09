import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import adminConfig from "../../apps/admin/next.config";
import shopConfig from "../../apps/shop/next.config";
import webConfig from "../../apps/web/next.config";

describe("architecture", () => {
  it("boundary check passes", () => {
    const out = execFileSync(process.execPath, ["scripts/check-boundaries.mjs"], {
      encoding: "utf8",
    });
    expect(out).toContain("Architecture boundaries OK");
  });
});

describe("rendering", () => {
  // Partial Prerendering: each page ships a prerendered static shell; request-time parts stream in
  // behind <Suspense> (docs/architecture.md#rendering).
  it("web, admin and shop enable Partial Prerendering (cacheComponents)", () => {
    const configs = { web: webConfig, admin: adminConfig, shop: shopConfig };
    for (const [app, config] of Object.entries(configs)) {
      expect(config.cacheComponents, app).toBe(true);
    }
  });
});
