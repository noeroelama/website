# Users and Roles pages

## What it does

**Roles** (`/roles`, `roles.read` / `roles.edit`): lists built-in and custom roles with how many
accounts hold each. A custom role is a name plus a checkbox grid of page permissions (read, edit
and the page's extras). "Add suggested roles" creates the starting set (admin, editor,
chapter_admin, chapter_editor, viewer, shop_manager) that is still missing. A role can be moved
to trash only when nobody holds it. Built-in roles are read-only.

**Users** (`/users`, `users.read` / `users.edit`): every account that has signed in, with status,
roles and last sign-in, filtered by role and status, 25 per page. An account page shows the
sign-in methods and lets staff give or remove a role (all chapters, or one chapter id) and
deactivate or reactivate the account.

## Where it lives

- Pages: `src/app/(panel)/roles/**`, `src/app/(panel)/users/**` (server actions in `actions.ts`).
- Rules: `src/server/roles.ts` (`createRoleActions`, `SUGGESTED_ROLES`), `src/server/accounts.ts`
  (`createAccountActions`), wired with Firestore in `src/server/wiring.ts` / `stores.ts`.
- Data: `@website/db` → `createFirestoreRoleStore`, `createFirestoreAccountStore`
  (`packages/db/docs/database.md`).
- Tests: `tests/integration/users-and-roles.test.ts`, `tests/unit/permissions.test.ts`.

## Rules and assumptions

- Escalation, superadmin-only superadmin, last superadmin and "not yourself" rules:
  `packages/permissions/docs/authorization.md`.
- Staff roles need two sign-in methods on the account (MFA factor, or passkey + Google/password).
  The person adds a passkey on web → Your account.
- Every change needs a sign-in in the last 15 minutes ("Sign in again" link otherwise), is
  written with its audit entry in one transaction (`module` `users` / `roles`, not revertible),
  then ends the account's sessions (`revokeRefreshTokens`) and logs `staff.role_changed`.
  Deactivation also disables the Firebase Auth account.
- Lists are global (`users.read` held globally); chapter-scoped lists come with the chapter scope
  rules.
- Concurrent edits: each form sends the version it showed; a stale version → "changed by someone
  else".

## Configuration

Composite indexes in `infrastructure/firebase/firestore.indexes.json` (deploy once).
