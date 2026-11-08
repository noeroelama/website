import { defineConfig } from "@playwright/test";

const isCI = Boolean(process.env["CI"]);
const testEnv = { APP_ENV: "test", API_KEY_PEPPER: "e2e-only-pepper-not-a-secret-0123456789" };

const apps = [
  { name: "web", port: 3000 },
  { name: "admin", port: 3001 },
  { name: "shop", port: 3002 },
  { name: "gateway", port: 3003 },
] as const;

export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  projects: apps.map((app) => ({
    name: app.name,
    testMatch: [`${app.name}.spec.ts`, "security.spec.ts"],
    use: { baseURL: `http://localhost:${app.port}` },
  })),
  webServer: apps.map((app) => ({
    command: `pnpm --filter ${app.name} start`,
    url:
      app.name === "gateway"
        ? `http://localhost:${app.port}/health`
        : `http://localhost:${app.port}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
    env: testEnv,
  })),
});
