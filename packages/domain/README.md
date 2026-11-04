# @website/domain

Business rules and data shapes, free of any framework.

## Responsibilities

- One module per area: `content`, `events`, `organizations`, `members`, `newsletter`, `forms`, `recruitment`, `documents`, `programs`, `shop`, `shared`
- Pure rules (e.g. `isPubliclyVisible`, `isRegistrationOpen`, `orderTotal`)
- Validation schemas (Zod) and repository _ports_ (interfaces) implemented in `@website/db`

## Structure

| Import                          | Contains                                                     |
| ------------------------------- | ------------------------------------------------------------ |
| `@website/domain/content`       | Content items, scheduled publishing rule                     |
| `@website/domain/events`        | Events, registrations, capacity rule                         |
| `@website/domain/organizations` | Countries, chapters                                          |
| `@website/domain/members`       | Member profile schema, field classification, audit redaction |
| `@website/domain/newsletter`    | Subscribers, double opt-in rule                              |
| `@website/domain/forms`         | Versioned form questions, answer schema built per version    |
| `@website/domain/recruitment`   | Oprec: application statuses, seats, choices, next action     |
| `@website/domain/documents`     | Letters: number patterns, desks, verification codes          |
| `@website/domain/programs`      | OKR, work programmes, LPJ, period report card                |
| `@website/domain/shop`          | Money, orders, payment provider port                         |
| `@website/domain/shared`        | Entity metadata, clock, results, time zones, file checks     |

## Rules

- No React, Next.js, Hono, Firebase, browser or Node APIs (lint + TypeScript enforced). Only `zod` and `@website/security/validation` (sanitization).
- `shop` imports no other module, so it can be extracted later.
- Time is injected (`now: Date`), never read implicitly.

## Commands

```bash
pnpm --filter @website/domain lint
pnpm --filter @website/domain typecheck
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
