import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import adminConfig from "../../apps/admin/next.config";
import shopConfig from "../../apps/shop/next.config";
import webConfig from "../../apps/web/next.config";

const ROOT = join(import.meta.dirname, "../..");
const CONFIGS = { web: webConfig, admin: adminConfig, shop: shopConfig };
// Next.js file conventions: 404, 403, 401, error in a page, error in the root layout.
const ERROR_FILES = ["not-found", "forbidden", "unauthorized", "error", "global-error"];
const pages = Object.keys(CONFIGS).flatMap((app) =>
  ERROR_FILES.map((file) => `apps/${app}/src/app/${file}.tsx`),
);

describe("error pages (no information exposure)", () => {
  it("web, admin and shop render 401/403 pages (authInterrupts)", () => {
    for (const [app, config] of Object.entries(CONFIGS)) {
      expect(config.experimental?.authInterrupts, app).toBe(true);
    }
  });

  it("every app has a page for each common error, built on the shared ErrorPage", () => {
    for (const path of pages) {
      expect(existsSync(join(ROOT, path)), path).toBe(true);
      expect(readFileSync(join(ROOT, path), "utf8"), path).toContain("<ErrorPage");
    }
  });

  it("error pages never show or log error details (they are only logged on the server)", () => {
    for (const path of [...pages, "packages/ui/src/error-page.tsx"]) {
      const source = readFileSync(join(ROOT, path), "utf8");
      expect(source, path).not.toMatch(/\.(message|stack|cause)\b/);
      expect(source, path).not.toMatch(/\bconsole\./);
    }
  });
});
