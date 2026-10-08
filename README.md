<div align="center">

# PPIDK Asia-Oseania Website

The official web platform of PPIDK Asia-Oseania: public website, member accounts,
administration, online shop and a public API — in one TypeScript monorepo.

[![CI](https://github.com/ppidk-asiania/website/actions/workflows/ci.yml/badge.svg?branch=dev)](https://github.com/ppidk-asiania/website/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-24%20LTS-339933?logo=node.js&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-12-F69220?logo=pnpm&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-Auth%20%7C%20Firestore-FFCA28?logo=firebase&logoColor=black)

</div>

---

## Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Workspaces](#workspaces)
- [Getting started](#getting-started)
- [Commands](#commands)
- [Branches and environments](#branches-and-environments)
- [Documentation](#documentation)
- [Engineering rules](#engineering-rules)

## Overview

| Application | Audience                                       | Domain              | Local port |
| ----------- | ---------------------------------------------- | ------------------- | ---------- |
| **Web**     | Public visitors and signed-in members          | `web.example.org`   | 3000       |
| **Admin**   | Staff: content, events, members, users, audit  | `admin.example.org` | 3001       |
| **Shop**    | Customers: products, cart, checkout, orders    | `shop.example.org`  | 3002       |
| **Gateway** | Third-party systems (versioned REST API `/v1`) | `api.example.org`   | 3003       |

Each application is deployed and fails independently: an admin or shop outage never takes down
the public website.

## Architecture

```text
   web            admin           shop           gateway
 (Next.js)      (Next.js)       (Next.js)        (Hono)
     │              │               │               │
     └──────────────┴───────┬───────┴───────────────┘
                            │  in-process imports (no shared API service)
       @website/* packages: domain · db · auth · permissions · audit
                            contracts · apikeys · email · ui · observability · config
                            │
     Firebase Auth (one user pool) · Firestore (all data) · Cloud Storage · Resend
```

- **Data** — Cloud Firestore for everything; browsers never access it directly.
- **Identity** — one Firebase Authentication user pool for staff, members and customers.
- **Access** — role-based access control (RBAC) evaluated on the server for every request.
- **Boundaries** — enforced by tooling (`pnpm lint`), not only by convention.

Details: [docs/architecture.md](docs/architecture.md).

## Workspaces

| Workspace                                                    | Responsibility                                          |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| [`apps/web`](apps/web/README.md)                             | Public website and member self-service                  |
| [`apps/admin`](apps/admin/README.md)                         | Staff administration                                    |
| [`apps/shop`](apps/shop/README.md)                           | Online shop                                             |
| [`apps/gateway`](apps/gateway/README.md)                     | Third-party API                                         |
| [`packages/domain`](packages/domain/README.md)               | Business rules (framework-free)                         |
| [`packages/db`](packages/db/README.md)                       | Firestore access, per application role                  |
| [`packages/auth`](packages/auth/README.md)                   | Identity verification and sessions                      |
| [`packages/permissions`](packages/permissions/README.md)     | Roles, permissions, authorization checks                |
| [`packages/audit`](packages/audit/README.md)                 | Append-only audit log and revert rules                  |
| [`packages/contracts`](packages/contracts/README.md)         | Public API request/response schemas                     |
| [`packages/apikeys`](packages/apikeys/README.md)             | API keys, scopes and rate limiting for the gateway      |
| [`packages/email`](packages/email/README.md)                 | Email sending (Resend)                                  |
| [`packages/ui`](packages/ui/README.md)                       | Shared React components                                 |
| [`packages/observability`](packages/observability/README.md) | Structured logging and security events                  |
| [`packages/security`](packages/security/README.md)           | Rate limiting, origin checks, sanitization, safe errors |
| [`packages/config`](packages/config/README.md)               | Environment validation and shared TypeScript configs    |

## Getting started

**Requirements:** Node.js 24 LTS, Git, and Corepack (bundled with Node). On Windows, check your
machine with `powershell -ExecutionPolicy Bypass -File scripts\doctor.ps1`.

```bash
corepack enable      # once per machine; provides the pinned pnpm version
pnpm install
pnpm dev             # starts all four applications
```

No `.env` file is needed for the start pages. To connect real services, copy
`apps/<app>/.env.example` to `apps/<app>/.env.local` and use **staging** values only.
See [docs/development.md](docs/development.md).

## Commands

| Command              | Purpose                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| `pnpm dev`           | Run all applications in watch mode (`pnpm --filter web dev` for one)                 |
| `pnpm verify`        | Everything CI runs: format, lint, typecheck, tests, build, secret scan               |
| `pnpm test`          | Unit, integration and security tests (Vitest) + 100% coverage check on security code |
| `pnpm test:security` | Security tests only                                                                  |
| `pnpm test:e2e`      | Smoke tests against production builds (Playwright)                                   |
| `pnpm lint`          | ESLint and the architecture boundary check                                           |
| `pnpm typecheck`     | TypeScript in every workspace                                                        |
| `pnpm build`         | Production build of every application                                                |
| `pnpm format`        | Format with Prettier                                                                 |

## Branches and environments

| Branch    | Environment            | Firebase project     |
| --------- | ---------------------- | -------------------- |
| `dev`     | Development (all work) | `ppidk-website-prod` |
| `staging` | Staging (release test) | `ppidk-website-prod` |
| `prod`    | Production (live)      | `ppidk-website-prod` |

Work is committed to `dev` and promoted by pull request `dev → staging → prod`.
No other branches are created. There is **one** Firebase project (one Firestore, one Auth) for every
environment, so `dev` and `staging` deployments work on the live data.
See [docs/deployment.md](docs/deployment.md) and [docs/environment.md](docs/environment.md).

## Documentation

- **Project-wide guides** live in [`docs/`](docs/README.md): architecture, development,
  environments, deployment, security and disaster recovery.
- **Feature documentation** lives next to the code, in each workspace's own `docs/` folder
  (for example [`packages/domain/docs`](packages/domain/docs/README.md)).
- Each workspace has a `README.md` describing what it owns and how to use it.

## Engineering rules

1. Reuse before adding; keep changes small and consistent with the existing code.
2. Write the test first, then the implementation; run `pnpm verify` before pushing.
3. Authorization is always checked on the server — never trust the browser.
4. Never commit secrets, `.env` files or service-account keys.
5. Update the relevant README or feature doc in the same commit as the change.

Full rules for contributors and AI assistants: [AGENTS.md](AGENTS.md).
