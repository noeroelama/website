# Documentation

## Where documentation lives

| Kind                  | Location                        | Example                            |
| --------------------- | ------------------------------- | ---------------------------------- |
| Project-wide guides   | `docs/` (this folder)           | Architecture, deployment, security |
| What a workspace owns | `<workspace>/README.md`         | `apps/admin/README.md`             |
| Feature documentation | `<workspace>/docs/<feature>.md` | `packages/domain/docs/members.md`  |

Put a feature doc in the workspace that **owns** the feature (where its main code lives).
If a feature spans several workspaces, document it in the one that owns the business rule
and link to it from the others.

## Project-wide guides

- [Architecture](architecture.md) — applications, packages and dependency rules
- [Development](development.md) — local setup and daily commands
- [Environments](environment.md) — development, staging, production
- [Deployment](deployment.md) — branches, CI/CD, rollback
- [Security](security.md) — controls and threat model
- [Disaster recovery](disaster-recovery.md) — backups and restore

## Feature docs index

| Feature                                                                | Doc                                                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Public site (frame, language ID/EN, Home, News, About, Terms, Privacy) | [apps/web/docs/public-site.md](../apps/web/docs/public-site.md)                             |
| News CMS (Article page, publish/schedule, rich text, preview)          | [packages/domain/docs/content.md](../packages/domain/docs/content.md)                       |
| Member profiles                                                        | [packages/domain/docs/members.md](../packages/domain/docs/members.md)                       |
| Image uploads (5 MB, WebP, thumbnail, Firebase Storage)                | [packages/db/docs/files.md](../packages/db/docs/files.md)                                   |
| Database                                                               | [packages/db/docs/database.md](../packages/db/docs/database.md)                             |
| Authentication (Google, email/password, passkeys, reset)               | [packages/auth/docs/authentication.md](../packages/auth/docs/authentication.md)             |
| Authorization                                                          | [packages/permissions/docs/authorization.md](../packages/permissions/docs/authorization.md) |
| Request security                                                       | [packages/security/docs/request-security.md](../packages/security/docs/request-security.md) |
| Audit logging                                                          | [packages/audit/docs/audit-logging.md](../packages/audit/docs/audit-logging.md)             |
| Messaging (message log, e-mail, Messages page)                         | [apps/admin/docs/messaging.md](../apps/admin/docs/messaging.md)                             |
| Cron jobs (cPanel) and incoming webhooks                               | [apps/admin/docs/cron.md](../apps/admin/docs/cron.md)                                       |
| Admin side panel                                                       | [apps/admin/docs/side-panel.md](../apps/admin/docs/side-panel.md)                           |
| Admin page pattern (list, add/edit form, confirm, labels)              | [apps/admin/docs/admin-shell.md](../apps/admin/docs/admin-shell.md)                         |
| Users and Roles pages (staff second sign-in method)                    | [apps/admin/docs/users-and-roles.md](../apps/admin/docs/users-and-roles.md)                 |
| Design tokens (colours, Poppins type scale, spacing)                   | [packages/ui/docs/design-tokens.md](../packages/ui/docs/design-tokens.md)                   |
| Error pages (401, 403, 404, 500)                                       | [packages/ui/docs/error-pages.md](../packages/ui/docs/error-pages.md)                       |

Add a row here when you add a feature doc.

## Feature doc template

Keep it short. Document what a future developer needs, not how you got there.

```markdown
# <Feature name>

## What it does

One paragraph, in plain words.

## Where it lives

- Code: `packages/.../src/...`
- Tests: `tests/unit/...`

## How to use it

Short example or the main entry points.

## Rules and assumptions

Permissions, validation, limits, data stored.

## Configuration

Environment variables or settings (or "None").
```
