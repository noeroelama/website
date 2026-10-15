# Request security

## What it does

Every request to every app passes one guard before it reaches a page, API route or server
action (`src/proxy.ts` in web/admin/shop, `requestGuard` middleware in the gateway):

1. **Origin restriction** — `/api/*` and every non-GET request must come from the same origin
   (`Origin` header or `Sec-Fetch-Site: same-origin`); otherwise `403`. Page navigation from other
   sites (links, search engines) is allowed. The gateway is the public API: server-to-server calls
   are allowed, browser calls from other websites are refused.
2. **Per-IP rate limit** — 100 requests/minute and 10,000 requests/day per client IP.
   10,000/day is far beyond normal use, so after it the client is **not blocked**: every further
   request that day is delayed by **500 ms** (`throttleDelayMs`) until 00:00 UTC. The 100/minute
   limit always applies: over it the response is `429` with `Retry-After`. Responses carry
   `RateLimit-Limit` and `RateLimit-Remaining`. Gateway API keys also have their own per-key minute limit.
3. **Private caching** — private paths get `Cache-Control: private, no-store`
   (web: `/api/`, `/account`; shop: `/api/`, `/account`, `/cart`, `/checkout`; admin and gateway: everything).

## Where it lives

- Policy and guard: `packages/security/src/` (`rate-limit.ts`, `request-guard.ts`, `errors.ts`, `validation.ts`)
- Shared counter store: `packages/db/src/firestore/rate-limit.ts` (`rateLimits/{key}`)
- App wiring: `apps/{web,admin,shop}/src/server/request-guard.ts` + `src/proxy.ts`;
  `apps/gateway/src/middleware/request-guard.ts`
- Tests: `tests/security/` (and `tests/e2e/security.spec.ts`)

## Rules and assumptions

- **Race conditions**: counters are updated in a Firestore transaction (atomic across all server
  instances); denied requests are not written. Transaction contention (only under bursts far above
  the limit) is treated as "limited".
- **Fail-open**: if the counter store is unavailable the request is allowed and the error is
  logged (`rate_limit_store_error`) — a database outage must not take the site down.
- **Privacy**: the key is `HMAC-SHA256(RATE_LIMIT_SECRET, ip)`; raw IPs are never stored.
- **Client IP**: `x-real-ip`, else the first `x-forwarded-for` value (set by the hosting reverse proxy, cPanel/Passenger).
- **Sanitization**: every free-text input uses `safeText(max)` (Unicode NFC, control/bidi/zero-width
  characters removed, whitespace collapsed, HTML rejected); every document id uses `safeId`
  (letters, digits, `_`, `-`; blocks `a/b`, `..`, `__reserved__`). Schemas are `.strict()`
  (unknown keys such as `__proto__`, `uid` or `role` are rejected).
- **Errors**: clients receive `{ "error": "<code>", "message": "<generic text>" }` (or RFC 9457 in
  the gateway). Stack traces and internal messages are only logged. Pages show the generic error
  pages instead ([error-pages.md](../../ui/docs/error-pages.md)).
- Cost: each guarded request performs one Firestore transaction in staging/production (~1 read + 1 write).
  A delayed request keeps its server function running for the extra 500 ms (billed time).

## Configuration

| Variable                                | Where            | Notes                                                                                                        |
| --------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `RATE_LIMIT_SECRET`                     | every app        | ≥ 32 chars, different per environment. Required in staging/production (the app refuses to serve without it). |
| `FIREBASE_*`                            | web, admin, shop | Counter store (staging/production only)                                                                      |
| Firestore TTL on `rateLimits.expiresAt` | Firebase         | Deletes old counters automatically (`infrastructure/firebase/README.md`)                                     |

## Cron secret and webhook signatures

- `bearerTokenMatches(header, secret)` — constant-time `Authorization: Bearer` check for
  `GET /cron/<job>` (admin). An empty secret never matches.
- `verifyHmacSignature({ payload, signature, secret, prefix, timestamp, now, toleranceSeconds })`
  — hex HMAC-SHA256 in constant time, optional `v0=`/`sha256=` prefix, timestamp tolerance
  against replays.
- `GuardOptions.signedWebhookPaths` — the only paths that skip the origin check (a path matches
  itself and its sub-paths, never look-alikes such as `/webhooks/zoomer`). See
  `apps/admin/docs/cron.md`.
