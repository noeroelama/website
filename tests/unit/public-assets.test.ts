import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const APPS = ["web", "admin", "shop"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe("public assets", () => {
  it("every image path an app references exists in that app's public folder", () => {
    for (const app of APPS) {
      const src = join(ROOT, "apps", app, "src");
      for (const path of files(src).filter((p) => /\.tsx?$/.test(p))) {
        const source = readFileSync(path, "utf8");
        for (const [, asset] of source.matchAll(
          /["'`(](\/[\w./-]+\.(?:png|webp|svg|jpe?g|gif))/g,
        )) {
          expect(
            existsSync(join(ROOT, "apps", app, "public", asset ?? "")),
            `${path}: ${asset}`,
          ).toBe(true);
        }
      }
    }
  });
});
