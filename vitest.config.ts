import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const serverOnlyStub = fileURLToPath(new URL("./tests/support/server-only.ts", import.meta.url));

export default defineConfig({
  test: {
    // Security code must be fully covered: `pnpm test` fails below 100%.
    coverage: {
      provider: "v8",
      include: [
        "packages/security/src/**/*.ts",
        "packages/auth/src/session-routes.ts",
        "packages/auth/src/passkeys.ts",
        "packages/auth/src/return-url.ts",
        "packages/db/src/firestore/passkeys.ts",
        "packages/db/src/memory/passkeys.ts",
        "apps/web/src/lib/auth-errors.ts",
        "packages/db/src/firestore/rate-limit.ts",
        "packages/db/src/firestore/batch.ts",
        "packages/db/src/users.ts",
        "packages/db/src/firestore/users.ts",
        "packages/db/src/firestore/audit.ts",
        "apps/*/src/server/request-guard.ts",
        "apps/gateway/src/middleware/request-guard.ts",
        "apps/admin/src/server/guarded-action.ts",
        "apps/admin/src/server/accounts.ts",
        "apps/admin/src/server/roles.ts",
        "apps/admin/src/server/images.ts",
        "apps/admin/src/server/audit-log.ts",
        "apps/admin/src/server/cron.ts",
        "apps/admin/src/server/messaging.ts",
        "packages/email/src/channel.ts",
        "apps/web/src/server/captcha.ts",
        "apps/web/src/server/registrations.ts",
        "packages/domain/src/messaging/index.ts",
        "packages/db/src/firestore/messages.ts",
        "packages/db/src/firestore/webhooks.ts",
        "packages/domain/src/shared/images.ts",
        "packages/domain/src/content/index.ts",
        "packages/db/src/firestore/content.ts",
        "apps/admin/src/server/news.ts",
        "packages/db/src/firestore/slugged.ts",
        "packages/db/src/firestore/events.ts",
        "packages/domain/src/events/index.ts",
        "packages/domain/src/shared/time.ts",
        "apps/admin/src/server/events.ts",
        "packages/domain/src/gallery/index.ts",
        "packages/db/src/firestore/gallery.ts",
        "apps/admin/src/server/gallery.ts",
      ],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
      reporter: ["text-summary"],
    },
    projects: [
      {
        resolve: { alias: { "server-only": serverOnlyStub } },
        test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        resolve: { alias: { "server-only": serverOnlyStub } },
        test: { name: "security", include: ["tests/security/**/*.test.ts"], environment: "node" },
      },
      {
        resolve: { alias: { "server-only": serverOnlyStub } },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
