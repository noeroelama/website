# gateway

The only public API for third-party systems (`/v1`).

## Responsibilities

- API-key authentication with scopes, per-key rate limits
- Validation and OpenAPI 3.1 generated from `@website/contracts`
- RFC 9457 error responses; `Idempotency-Key` required on writes

## Structure

| Path              | Purpose                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- |
| `src/app.ts`      | Builds the Hono app (routes, middleware, errors).                                      |
| `src/routes/`     | Endpoints: `GET /health`, `GET /v1/health`, `GET /v1/events`, `GET /v1/openapi.json`.  |
| `src/middleware/` | Request guard (per-IP rate limit, origin, no-store), API key, idempotency, request ID. |
| `src/deps.ts`     | Composition root (in-memory adapters in development/test).                             |
| `src/server.ts`   | Node server: `pnpm dev`, `pnpm start`, and cPanel (`dist/server.js`).                  |

## Rules

- Domain `api.example.org`, local port **3003**.
- Never imports staff auth, permissions, audit, UI or member personal data (lint-enforced).
- Responses are explicit DTOs from `@website/contracts`, never database documents.

## Commands

```bash
pnpm --filter gateway dev   # http://localhost:3003/health
pnpm --filter gateway build
pnpm --filter gateway lint
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
