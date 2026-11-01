# @website/db

Database access (MySQL 8 on cPanel) and file storage (cPanel disk), exposed per application role.

## Responsibilities

- Implements the repository ports declared in `@website/domain`
- Gives each app only the repositories its role allows (`web_ro`, `admin_rw`, `shop_rw`, `gateway_rw`)
- In-memory repositories for development and tests

## Structure

| Import               | Contains                                                                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@website/db`        | Role types and repository sets per role                                                                                                                                                |
| `@website/db/sql`    | `getDatabaseForRole()` (pooled MySQL; `mysql2` only in `src/sql/store.ts`), repositories, rate-limit and passkey stores, `getDocumentsByIds`, `createDiskFileStorage`, `deleteExpired` |
| `@website/db/memory` | In-memory repositories for tests and local development                                                                                                                                 |

## Rules

- Server-only. Apps import it only from `src/server/**`.
- Every collection is a MySQL table listed in `src/sql/collections.ts` (created on first use).

## Commands

```bash
pnpm --filter @website/db lint
pnpm --filter @website/db typecheck
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
