# Development

## Prerequisites (Windows)

| Tool    | Version                                     | Notes                                                                                                          |
| ------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Node.js | 24 LTS (22.12+ also accepted)               | `.nvmrc` = 24. Odd-numbered releases (23, 25) are not supported: they are short-lived and Vitest refuses them. |
| pnpm    | pinned in `package.json` (`packageManager`) | Via Corepack — do **not** install pnpm globally with a different version.                                      |
| Git     | ≥ 2.40                                      | `core.autocrlf=false` recommended; `.gitattributes` enforces LF.                                               |

Check your machine (read-only):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\doctor.ps1
```

Enable Corepack once (admin PowerShell may be needed):

```powershell
corepack enable
```

## First run

```bash
pnpm install
pnpm dev
```

| App     | URL                                                                  |
| ------- | -------------------------------------------------------------------- |
| web     | http://localhost:3000                                                |
| admin   | http://localhost:3001                                                |
| shop    | http://localhost:3002                                                |
| gateway | http://localhost:3003/health · http://localhost:3003/v1/openapi.json |

No `.env.local` is needed for the smoke pages. When you need real services, copy
`apps/<app>/.env.example` to `apps/<app>/.env.local` and fill in real values (one Firebase project for every environment; never set emulator variables).

Run one app: `pnpm --filter web dev` (or `admin`, `shop`, `gateway`).

## Commands

| Command                        | What it does                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `pnpm dev`                     | All four apps in watch mode                                                                        |
| `pnpm build`                   | Production build of every app (Turborepo-cached)                                                   |
| `pnpm lint`                    | ESLint (type-aware) + architecture boundary check                                                  |
| `pnpm lint:boundaries`         | Boundary check only (`--graph` to print)                                                           |
| `pnpm typecheck`               | `tsc` in every workspace + root tests/scripts                                                      |
| `pnpm test`                    | Vitest: `tests/unit`, `tests/integration`, `tests/security` + 100% coverage check on security code |
| `pnpm test:security`           | Security tests only                                                                                |
| `pnpm test:e2e`                | Playwright smoke against production builds (run `pnpm build` first)                                |
| `pnpm format` / `format:check` | Prettier                                                                                           |
| `pnpm check:secrets`           | Secret scan of everything that would be committed                                                  |
| `pnpm verify`                  | Everything above, in CI order                                                                      |

## Tests

```text
tests/unit         pure rules: permissions, audit/revert, env isolation, domain, api keys
tests/integration  gateway over HTTP (in-process), admin guarded actions, boundary check
tests/security     rate limit, origin, sanitization, sessions (OAuth), errors, race conditions, pooling, N+1
tests/e2e          Playwright request-level smoke against built apps (no browser download needed)
```

## Conventions

- Strict TypeScript; `any` is a lint error. Justify any `eslint-disable` inline.
- Server-only code in apps lives in `src/server/**` and starts with `import "server-only"`.
- Admin mutations are defined only with `createGuardedAction`.
- Money is integer minor units (`domain/shop`).
- Telemetry: `npx turbo telemetry disable` and `npx next telemetry disable` if you prefer.
