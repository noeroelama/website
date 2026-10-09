# web

Public website of PPIDK Asia-Oseania and the member self-service area.

## Responsibilities

- Landing pages, news, articles, events, gallery, organization and chapters
- Member sign-up/sign-in (Google, email/password, passkeys), password reset, own-profile management (same user pool as admin and shop)
- Public forms (newsletter, event registration) protected by reCAPTCHA

## Structure

| Path                                              | Purpose                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `src/app/`                                        | Pages (App Router). Partial Prerendering: public pages are prerendered, so they survive outages.             |
| `src/proxy.ts`                                    | Runs before every request: origin check, per-IP rate limit, private caching (`src/server/request-guard.ts`). |
| `src/app/api/session/route.ts`                    | Sign-in/out: Google OAuth ID token → HttpOnly session cookie (`src/server/session.ts`).                      |
| `src/app/{login,signup,forgot-password,account}/` | Sign-in pages: Google, email/password, passkeys, password reset, account (add passkey, sign out).            |
| `src/app/api/passkeys/[action]/route.ts`          | Passkey registration and sign-in endpoints (`src/server/passkeys.ts`).                                       |
| `src/lib/auth-client.ts`                          | Browser sign-in flows (Firebase Auth SDK + WebAuthn); ends in the session cookie.                            |
| `src/server/`                                     | Server-only code (`import "server-only"`): env, database and auth access.                                    |
| `.env.example`                                    | Variables this app needs.                                                                                    |

## Rules

- Domain `web.example.org`, local port **3000**.
- May read public content and the signed-in user's **own** profile only (`profile.*_own`).
- No admin tooling: may not import `@website/audit`, `@website/apikeys` or `@website/domain/shop`.

## Commands

```bash
pnpm --filter web dev       # http://localhost:3000
pnpm --filter web build
pnpm --filter web lint
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
