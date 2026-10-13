# @website/permissions

Role-based access control (RBAC), evaluated on the server.

## Responsibilities

- The admin page catalogue (`ADMIN_PAGES`: read / edit / extras per page) and self-service
  permissions
- Built-in roles (`superadmin`, `member`, `user`); custom roles are Firestore data
- `can()`, `requirePermission()`, `canAccessAdmin()`, `canInSomeScope()` (what to show)
- Anti-escalation checks: `canSaveRole()`, `canDeleteRole()`, `canAssignRole()`

## Structure

| File                 | Contains                                                                    |
| -------------------- | --------------------------------------------------------------------------- |
| `src/permissions.ts` | `ADMIN_PAGES`, `PAGE_PERMISSIONS`, `normalizePermissions()`, `SYSTEM_ROLES` |
| `src/policy.ts`      | `Principal`, `resolveAssignments()`, checks, default roles for new accounts |

## Rules

- Deny by default. Adding an admin page is a reviewed code change; role contents are data.
- Never derive roles from client input or token claims.

## Commands

```bash
pnpm --filter @website/permissions lint
pnpm --filter @website/permissions typecheck
```

## Documentation

Feature docs for this workspace: [`docs/`](docs/README.md) — start with
[authorization.md](docs/authorization.md).
Project-wide guides: [../../docs/](../../docs/README.md).
