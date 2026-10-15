# @website/audit

Append-only audit log model and revert rules.

## Responsibilities

- `AuditEvent` shape and the append-only writer port
- Display diffs between snapshots
- 14-day revert policy and revert events

## Structure

| Export                                   | Purpose                                               |
| ---------------------------------------- | ----------------------------------------------------- |
| `AuditEvent`, `AuditAppender`            | Record shape and the append-only port                 |
| `diffSnapshots()`                        | Field-level diff for display                          |
| `onlyChangedFields()`, `canonicalJson()` | What an entry stores; stable JSON for the hash chain  |
| `evaluateRevert()`, `buildRevertEvent()` | Server-side revert decision and the new revert record |

## Rules

- No update or delete API exists, by design.
- Personal data is redacted before it reaches an audit event (see `@website/domain/members`).

## Commands

```bash
pnpm --filter @website/audit lint
pnpm --filter @website/audit typecheck
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md).
Project-wide guides: [../../docs/](../../docs/README.md).
