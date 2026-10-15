<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# Project rules (for humans and AI agents)

Read `docs/architecture.md` before changing structure. Non-negotiable:

- Four deployables (`apps/web`, `apps/admin`, `apps/shop`, `apps/gateway`) in one monorepo. No new apps, services, queues or job workers without an architecture decision.
- Respect the dependency matrix. `pnpm lint` runs `scripts/check-boundaries.mjs`; never weaken it to make a change pass.
- `packages/domain` is framework-free: no React/Next/Hono/Firebase/browser/Node APIs. Declare a port instead.
- Firebase Admin is imported only in `packages/db/src/firestore/**` and `packages/auth/src/firebase-admin.ts` (plus local, never-deployed ops scripts in `infrastructure/scripts/`); the browser SDK (`firebase/app`, `firebase/auth` only) only in `apps/web/src/lib/{firebase-client,auth-client}.ts`.
- In apps, infrastructure (`@website/db`, `@website/email`, auth adapters) is used only from `src/server/**` files that `import "server-only"`.
- Every admin mutation uses `createGuardedAction` (authenticate → validate → authorize → domain → audit in the same transaction). Never authorize in UI, middleware/`proxy.ts`, or from client-supplied roles.
- The gateway never imports `@website/auth`, `@website/permissions`, `@website/audit` or `@website/ui`. Public responses are explicit DTOs from `@website/contracts`.
- All data is in Firestore; one Firebase Auth user pool for everyone; authorization is RBAC (`@website/permissions`): role assignments in `users/{uid}`, custom roles in `roles/{id}` edited in the admin Roles page (read/edit per admin page) — never Custom Claims.
- Member personal data (`packages/domain/docs/members.md`) is read only with `members.pii` or `profile.read_own`, never exposed via the gateway, and never written to audit logs unredacted (use `profileAuditSnapshots`).
- Security (`packages/security/docs/request-security.md`): every request passes the request guard; free text uses `safeText`, document ids use `safeId`, schemas are `.strict()`; errors returned to clients are generic (`jsonError`/problem details); lists load documents with `getDocumentsByIds`, never in a loop; Firestore clients come from `getFirestoreForRole` (pooled); read-modify-write uses transactions. New security code must keep `pnpm test` at 100% coverage.
- Never commit `.env*` (except `.env.example` with empty placeholders), keys or service-account JSON.
- Documentation: each workspace has a `README.md` (what it owns) and a `docs/` folder for its feature docs; project-wide guides are in `/docs`. Update them in the same commit as the code.
- Strict TypeScript; no `any`. Run `pnpm verify` before proposing a change.
