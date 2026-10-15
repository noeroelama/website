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

Each app is its own Node.js app on DomaiNesia cPanel (DEC-14) and its own failure boundary. A
broken admin deploy cannot take down the public site; the public site serves prerendered pages even
if the database is down.

## Applications

| App            | Responsibility                                                                                            | Must never                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `apps/web`     | Public pages: landing, news, articles, events, gallery, organization, chapters                            | Contain admin functionality or staff auth                             |
| `apps/admin`   | CMS, galleries, events, newsletter, organization, users, audit/revert, QR, Zoom, calendar tools           | Trust client state; write to Firestore from the browser               |
| `apps/shop`    | Products, categories, cart, checkout (hosted), orders, customer account                                   | Import non-shop domain modules                                        |
| `apps/gateway` | The **only** entry point for third-party systems: `/v1`, API keys, scopes, rate limits, OpenAPI, RFC 9457 | Import staff auth/session, admin authorization, audit internals or UI |

Internal Server Actions and Route Handlers in web/admin/shop are same-origin only and undocumented.

## Packages

| Package         | Responsibility                                                                                          | Depends on                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `security`      | Per-IP rate limiting, origin restriction, input sanitization, safe errors, private caching              | `zod` only                                                    |
| `config`        | Zod env schemas, environment-isolation guard, shared tsconfigs                                          | —                                                             |
| `contracts`     | External API DTOs, errors (RFC 9457), pagination, versions (Zod → OpenAPI)                              | —                                                             |
| `domain`        | Business rules + ports, by module: `content`, `events`, `organizations`, `newsletter`, `shop`, `shared` | —                                                             |
| `permissions`   | Roles, permissions, scoped `can()` / `requirePermission()`                                              | —                                                             |
| `audit`         | Append-only audit event model, diff, revert policy (14 days)                                            | —                                                             |
| `apikeys`       | Third-party key format, hashing, verification, scopes, rate-limit port                                  | —                                                             |
| `email`         | `EmailSender` port, Resend adapter, in-memory adapter                                                   | —                                                             |
| `observability` | Structured logging with redaction, request IDs, security events                                         | —                                                             |
| `ui`            | Presentational React components (no data access, no auth decisions)                                     | —                                                             |
| `auth`          | Identity port, session cookie policy, Firebase Admin adapter                                            | `config`                                                      |
| `db`            | Database access per role; Firestore confined to `src/firestore/`                                        | `domain`, `config`, `apikeys`, `auth`, `permissions`, `audit` |

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
db        → apikeys, audit, auth, config, domain, permissions, security
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
A layout must render `{children}` on every path (also in its `<Suspense>` fallback); a layout that
returns something else for signed-out users drops the page segment and fails instant-navigation
validation. Pages check the session themselves.
**Login-required pages** (any app) use `export const instant = false` and redirect a signed-out
visitor straight to the web sign-in page with a return link: `redirect(signInUrl(WEB_URL, <this
page's URL>))` (`signInUrl` from `@website/auth`; on web itself `signInUrl("", "/path")`). In
admin use `requireAdminViewer(path)` from `src/server/context.ts`, which does this and shows the
restricted (403) page (`forbidden()`) to signed-in accounts without a staff role.
The shell must never contain personal data; authentication and authorization still run on the
server for every request (inside the `<Suspense>` part). Current pages: web `/`, `/login`,
`/signup`, `/forgot-password` and shop `/` are fully static; admin pages (`(panel)` group) use `instant = false` and
`requireAdminViewer`; web `/account` uses `instant = false` and redirects to `/login?next=/account`. Next.js guide:
`node_modules/next/dist/docs/01-app/02-guides/migrating-to-cache-components.md`.

## Asynchronous work

There is no job system by design. Side effects (email, Zoom) are synchronous with timeouts and
run after the database transaction commits; failures are recorded with a status and retried from
admin. Time-based rules are read-time rules wherever possible (`isPubliclyVisible`, offer expiry,
overdue deadlines). Newsletter campaigns use Resend Broadcasts.

Work that must happen without a visitor (reminders, retries, archiving) uses **cPanel Cron Jobs**
(DEC-4): a crontab line calls admin `GET /cron/<job>` (outside `/api/`) with
`Authorization: Bearer CRON_SECRET`. Each job is idempotent, handles one bounded batch per call,
stores its progress in Firestore and logs a summary; the next call continues (DEC-14: shared
hosting ends long requests). No self-hosted worker or queue. See
[deployment.md](deployment.md#scheduled-jobs-cpanel-cron-jobs).

## Incoming webhooks

Third-party callbacks (Zoom, WhatsApp) arrive in admin at `/webhooks/<provider>` (DEC-5). The
request guard skips **only** the origin check for an explicit allowlist of these paths; rate
limiting and private caching still apply. Each handler verifies the provider signature and
timestamp first, de-duplicates by provider event id (`webhookEvents/{provider}_{eventId}`,
created in a transaction), and answers with a generic body.

## Decisions

Recorded 2026-10-12. Changing one of these is an architecture decision (same PR updates the code
guard, the boundary script/ESLint config if needed, and this file).

| #      | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEC-1  | Organisation management lives in the existing apps: staff screens in `apps/admin`; member self-service and public pages (verification, public forms) in `apps/web`. The gateway exposes none of it yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| DEC-2  | (Roles themselves are data, see DEC-11.) Role scopes gain `orgUnit` (covers the unit and every unit below it) and assignments gain `periodId` (only the active period counts) and `source` (appointment or manual). `can()` stays pure.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| DEC-3  | New domain modules are added under `packages/domain/src/` as they are built; each module step updates the dependency matrix for `web` when it needs the module. Domain stays framework-free.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| DEC-4  | Scheduled work (rewritten 2026-10-16 for DomaiNesia): read-time rules first; otherwise cPanel Cron Jobs call admin `GET /cron/<job>` with a bearer `CRON_SECRET` read from a `chmod 600` file in the account home (constant-time compare, unknown job 404). Jobs are idempotent, bounded per call (target < 30 s) and keep progress in Firestore.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| DEC-5  | Webhooks: admin `/webhooks/<provider>`, origin check skipped only for an explicit allowlist, signature + timestamp verified, event-id de-duplication.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| DEC-6  | Documents: `pdf-lib` (create and stamp PDFs) and `qrcode`, added when the documents phase starts; one renderer and one QR generator behind ports, used only from `src/server/**`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| DEC-7  | Messaging: one messaging port; email (Resend) first, then WhatsApp — Cloud API for chatbot replies inside the 24-hour window, WAHA for proactive notifications and polls, on one number.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| DEC-8  | `Money` (integer minor units + ISO 4217) moves from `domain/shop` to `domain/shared` so finance can use it without importing the shop module.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| DEC-9  | Search is menu search + lower-case prefix fields (no external search service). Logs (rewritten 2026-10-16): structured JSON to stdout/stderr, kept by Passenger in each app's `stderr.log`; uptime checks call the `/health` routes. A Firestore log viewer for superadmins comes when the management modules go live (DEC-17).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| DEC-10 | Letters and certificates issued before the platform are imported once (numbers, verification codes, counters) by a local script with a dry-run mode, before the verification page goes live.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| DEC-11 | Roles are data (2026-10-13): custom roles are Firestore documents created and edited in the admin Roles page; each admin page has read and edit permissions plus named extras where needed (e.g. `members.pii`). Only `superadmin`, `member` and `user` are built in. Anti-escalation: you can only grant what you hold globally.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| DEC-12 | Images (updated 2026-10-16, follows the PPIT pattern and the Figma flowchart): only jpg/jpeg/png/webp, at most **5 MB**, checked in the browser and again on the server. The browser compresses to WebP; the server detects the real type from the bytes, re-encodes with sharp (≤ 2400 px, WebP q82, metadata stripped) and also makes a **480 px wide thumbnail**; both go to Firebase Storage. Public images get a long-cached download URL, private images (KTM, signatures) are served by 15-minute signed URLs. SVG is refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| DEC-13 | One session for web, admin and shop (2026-10-13): one HttpOnly `__Secure-session` cookie on the parent domain (`SESSION_COOKIE_DOMAIN`); sign in once on web, signed in everywhere; sign-out revokes everywhere. Permissions are still checked per app (admin needs a staff role). Trade-off accepted: every subdomain receives the cookie, so DNS must stay clean.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| DEC-14 | Hosting = DomaiNesia cPanel (2026-10-16), replacing Vercel: Setup Node.js App (CloudLinux + Passenger), one app per deployable. web/admin/shop are built in GitHub Actions (`NEXT_OUTPUT=standalone`) and uploaded; the gateway is built on the server. Passenger may stop idle apps and run several processes: no shared in-memory state, no background workers, `"use cache"` lists use `cacheLife("minutes")` at most. Long work is split into bounded calls. Secrets live in each app's cPanel screen; each app has its own service account. Only `prod` deploys; no previews.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| DEC-15 | PPIDK data moves per module (2026-10-16, extends DEC-10): each management module replaces its PPIDK (Laravel) screen only after its data is imported — freeze the PPIDK screen, export TSV, run `infrastructure/scripts/import-ppidk-<module>.mjs` (local, `--dry-run` first, idempotent, `ppidkId` kept), match users by e-mail, verify counts, then switch the menu entry. Verification codes keep their original values so printed QR codes keep working.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| DEC-16 | Website flowchart decisions (2026-10-16, recommended answers of the flowchart review adopted; the owner may revise): (1) public sign-up stays — everyone signs up as `user`; staff access comes only from a role given on the Users page (no separate admin accounts). (2) Admin has no sign-in screen of its own: it sends signed-out visitors to the web sign-in page (shared session, DEC-13); password-guessing limits are Firebase Auth's (`auth/too-many-requests`) plus the per-IP limit. (3) Staff sign-ins are a security event in the logs and "last sign-in" on the Users page, not audit-log rows (the audit log records changes to records). (4) Events, albums and articles are soft-deleted (`deletedAt`) so audit revert can restore them; the confirm dialog says "Move to trash". (5) No D3 or GSAP: the map is a server-rendered SVG, counters are plain numbers, animations are CSS transitions — a library is added only if a design needs pan/zoom. Flowchart names map to ours: `adminLogs` = `auditLogs`, `news` = `content` (kind `news`). |
| DEC-17 | PPIDK features not ported (2026-10-16, recommended answers adopted; the owner may revise): no magic-link e-mail sign-in (Google, e-mail + password and passkeys are enough); no role mailboxes (`sekjen@…` signing in as the seat holder) — appointments grant the roles; the Firestore log viewer for superadmins (PPIDK's database log viewer) is built when the management modules go live (settings and operations step), until then `stderr.log` (DEC-9). Still open for the owner: the main domain name and whether to run a `staging.*` set of apps (docs/deployment.md owner checklist).                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
