# admin

Staff administration for content, events, members, users and audit.

## Responsibilities

- CMS: news, articles, pages, galleries, events, organization and chapters
- Members: approval and profile access (`members.*` permissions)
- Users and roles, audit log and 14-day revert
- Tools: QR codes, Zoom meeting requests, calendar feed

## Structure

| Path                           | Purpose                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`                     | Pages (App Router). Partial Prerendering: data-free shell; session parts stream in `<Suspense>`.                                                        |
| `src/app/(panel)/layout.tsx`   | Every staff page: the side panel (`src/components/admin-sidebar.tsx`), see [docs/side-panel.md](docs/side-panel.md).                                    |
| `src/navigation.ts`            | Side panel pages, in order, with the permission each one needs.                                                                                         |
| `src/proxy.ts`                 | Runs before every request: origin check, per-IP rate limit, private caching, sign-in redirect without a session cookie (`src/server/request-guard.ts`). |
| `src/app/health/route.ts`      | `GET /health` → `{"status":"ok"}` for uptime checks (no database call, no sign-in).                                                                     |
| `src/app/api/session/route.ts` | Sign-in/out: Google OAuth ID token → HttpOnly session cookie (`src/server/session.ts`).                                                                 |
| `src/server/context.ts`        | `getAdminViewer()` / `getPrincipal()` — session → Firebase → roles in Firestore; staff only. `requireAdminViewer(path, permission)` gates each page.    |
| `src/server/guarded-action.ts` | `createGuardedAction()` — the only way to write an admin mutation.                                                                                      |
| `src/server/user-directory.ts` | uid → account status + roles from Firestore (`@website/db`); no record or no staff role = no access.                                                    |

## Rules

- Domain `admin.example.org`, local port **3001**.
- Only accounts with a staff role (`admin.access`) get in; members and customers are refused.
- Every mutation: authenticate → validate → authorize → domain logic → audit (same transaction).
- Never reads or writes Firestore from the browser.

## Commands

```bash
pnpm --filter admin dev     # http://localhost:3001
pnpm --filter admin build
pnpm --filter admin lint
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
