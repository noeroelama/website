# Architecture

## Shape

One monorepo, four independently deployed applications, shared packages. No microservices,
no queues, no self-managed workers.

```text
                 web.example.org    admin.example.org   shop.example.org    api.example.org
                 apps/web           apps/admin          apps/shop           apps/gateway
                 (Next.js, PPR)     (Next.js, PPR)      (Next.js, PPR)      (Hono, /v1)
                      │                  │                   │                   │
                      └──────────────────┴─────────┬─────────┴───────────────────┘
                                                   │  in-process imports (no shared API service)
               packages/: domain · db · auth · permissions · audit · contracts · apikeys
                          email · ui · observability · config
                                                   │
                      Firebase Auth · Firestore (behind @website/db) · Storage · Resend · payment provider
```

Each app is its own Vercel project and failure boundary. A broken admin deploy cannot take
down the public site; the public site serves prerendered pages even if the database is down.

## Applications

| App            | Responsibility                                                                                            | Must never                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `apps/web`     | Public pages: landing, news, articles, events, gallery, organization, chapters                            | Contain admin functionality or staff auth                             |
| `apps/admin`   | CMS, galleries, events, newsletter, organization, users, audit/revert, QR, Zoom, calendar tools           | Trust client state; write to Firestore from the browser               |
| `apps/shop`    | Products, categories, cart, checkout (hosted), orders, customer account                                   | Import non-shop domain modules                                        |
| `apps/gateway` | The **only** entry point for third-party systems: `/v1`, API keys, scopes, rate limits, OpenAPI, RFC 9457 | Import staff auth/session, admin authorization, audit internals or UI |

Internal Server Actions and Route Handlers in web/admin/shop are same-origin only and undocumented.

## Packages

| Package         | Responsibility                                                                                          | Depends on                    |
| --------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `security`      | Per-IP rate limiting, origin restriction, input sanitization, safe errors, private caching              | `zod` only                    |
| `config`        | Zod env schemas, environment-isolation guard, shared tsconfigs                                          | —                             |
| `contracts`     | External API DTOs, errors (RFC 9457), pagination, versions (Zod → OpenAPI)                              | —                             |
| `domain`        | Business rules + ports, by module: `content`, `events`, `organizations`, `newsletter`, `shop`, `shared` | —                             |
| `permissions`   | Roles, permissions, scoped `can()` / `requirePermission()`                                              | —                             |
| `audit`         | Append-only audit event model, diff, revert policy (14 days)                                            | —                             |
| `apikeys`       | Third-party key format, hashing, verification, scopes, rate-limit port                                  | —                             |
| `email`         | `EmailSender` port, Resend adapter, in-memory adapter                                                   | —                             |
| `observability` | Structured logging with redaction, request IDs, security events                                         | —                             |
| `ui`            | Presentational React components (no data access, no auth decisions)                                     | —                             |
| `auth`          | Identity port, session cookie policy, Firebase Admin adapter                                            | `config`                      |
| `db`            | Database access per role; Firestore confined to `src/firestore/`                                        | `domain`, `config`, `apikeys` |

Audit logic lives only in `packages/audit` (not also in `domain/audit`) so there is one owner.

## Dependency rules

Enforced by tooling, not just this document:

1. **`scripts/check-boundaries.mjs`** (run by `pnpm lint` and CI): workspace dependency matrix,
   no undeclared (`phantom`) imports, no relative imports escaping a workspace, subpath rules,
   no cycles. `node scripts/check-boundaries.mjs --graph` prints the graph.
2. **ESLint `no-restricted-imports`** (`eslint.config.mjs`): per-folder import rules.
3. **TypeScript `lib`/`types`**: `domain` compiles without DOM or Node types, so browser and
   runtime APIs do not type-check there.

Approved matrix:

```text
web       → auth, config, contracts, db, domain(content|events|organizations|newsletter|members|shared), email, observability, permissions, security, ui
admin     → audit, auth, config, db, domain, email, observability, permissions, security, ui
shop      → auth, config, db, domain(shop|shared), email, observability, permissions, security, ui
gateway   → apikeys, config, contracts, db, domain(content|events|organizations|shared), observability, security
auth      → config, security
db        → apikeys, config, domain, security
domain    → security(validation)
contracts → security(validation)
others    → (none)
```

Forbidden (fails lint): app → app, package → app, gateway → auth/permissions/audit/ui/email/domain-members (no personal data via the API),
shop → non-shop domain, domain → React/Next/Hono/Vercel/Firebase/any workspace package except `@website/security/validation`,
domain/shop ↔ other domain modules, any Firebase import outside `packages/db/src/firestore/**`
and `packages/auth/src/firebase-admin.ts`, infrastructure (`@website/db`, `@website/email`,
Firebase admin adapter) from app code outside `src/server/**`.

Changing the matrix is an architecture decision: update the script, ESLint config and this file
in the same PR.

## Request flow (admin mutation)

```text
UI → Server Action → createGuardedAction:
       authenticate (session cookie → Firebase verify + revocation → users/{uid} roles in Firestore; staff role required)
       → validate (Zod) → authorize (permissions.can, scoped)
       → domain logic → repository (@website/db) + audit event in the SAME transaction
```

## Rendering

web, admin and shop use **Partial Prerendering** (`cacheComponents: true` in each
`next.config.ts`; checked by `tests/integration/architecture.test.ts`). At build, Next.js
prerenders a static shell for every page; anything that needs the request streams in afterwards.

| Page content                                   | What to do                                                                              |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| Static (layout, headings, client-side forms)   | Nothing — it is in the shell.                                                           |
| Shared data (news, events, products)           | `"use cache"` + `cacheLife(...)` (+ `cacheTag` to revalidate on publish). In the shell. |
| Per-user (`cookies()`, session, principal)     | Put the component that reads it inside `<Suspense>`; the rest of the page stays static. |
| Whole page is per-user and must redirect (307) | `export const instant = false` on the page — it renders at request time, no shell.      |

`export const dynamic`, `revalidate` and `fetchCache` are not allowed with Cache Components.
The shell must never contain personal data; authentication and authorization still run on the
server for every request (inside the `<Suspense>` part). Current pages: web `/`, `/login`,
`/signup`, `/forgot-password` and shop `/` are fully static; admin `/` is a static shell with the
sign-in state streamed; web `/account` uses `instant = false`. Next.js guide:
`node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md`.

## Asynchronous work

There is no job system by design. Side effects (email, Zoom) are synchronous with timeouts;
failures are recorded with a status and retried manually from admin. Scheduled publishing is a
read-time rule (`isPubliclyVisible`). Newsletter campaigns use Resend Broadcasts. If automatic
retries become necessary, add a **managed** HTTP queue at that time — not a self-hosted worker.
