import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("web, admin and shop enable Partial Prerendering (cacheComponents)", () => {
    const configs = { web: webConfig, admin: adminConfig, shop: shopConfig };
    for (const [app, config] of Object.entries(configs)) {
      expect(config.cacheComponents, app).toBe(true);
    }
  });
});

describe("standalone build (cPanel)", () => {
  const repoRoot = path.resolve(import.meta.dirname, "../..");
  const loaders = {
    web: () => import("../../apps/web/next.config"),
    admin: () => import("../../apps/admin/next.config"),
    shop: () => import("../../apps/shop/next.config"),
  };

  it("turbo passes NEXT_OUTPUT to the build task", () => {
    const turbo = JSON.parse(readFileSync(path.join(repoRoot, "turbo.json"), "utf8")) as {
      tasks: { build: { env: string[] } };
    };
    expect(turbo.tasks.build.env).toContain("NEXT_OUTPUT");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each(Object.keys(loaders) as (keyof typeof loaders)[])(
    "%s builds standalone only when NEXT_OUTPUT=standalone",
    async (app) => {
      expect((await loaders[app]()).default.output).toBeUndefined();

      vi.stubEnv("NEXT_OUTPUT", "standalone");
      vi.resetModules();
      const config = (await loaders[app]()).default;
      expect(config.output).toBe("standalone");
      expect(config.outputFileTracingRoot).toBe(repoRoot);
    },
  );
});
