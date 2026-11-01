# @website/security

Request security shared by every app: rate limiting, origin restriction, input
sanitization, safe error responses and private caching headers.

## Responsibilities

- Per-IP rate limit: **100 requests/minute**, **10,000/day**, then every request is **delayed by 500 ms** until 00:00 UTC (not blocked)
- Origin restriction: internal APIs and form posts only from our own site
- `Cache-Control: private, no-store` on private paths
- Input sanitization for every free-text field and every document id
- Error responses without internal details

## Structure

| Import                         | Contains                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `@website/security`            | `guardRequest`, `createRequestGuard`, rate-limit policy/stores, `toPublicError`, `jsonError` |
| `@website/security/validation` | `safeText`, `safeId`, `sanitizeText` (zod only — usable from the domain)                     |

## Rules

- Framework-free. The MySQL counter store lives in `@website/db/sql`.
- The in-memory store is for development/test only; staging/production use MySQL.

## Commands

```bash
pnpm test:security                          # security tests only
pnpm test                                   # all tests + 100% coverage check on security code
pnpm --filter @website/security typecheck
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
