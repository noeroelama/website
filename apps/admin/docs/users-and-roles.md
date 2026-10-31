# Role Manager (people and roles)

## What it does

One page, **Role Manager** in the side panel, for who holds which role and what each role may do.

**People** (`/roles`, `users.read` / `users.edit`): everyone who holds a role other than the
default `user`, plus pending invites (inactive and invited rows carry a badge). Tabs per role
(with counts), search by name or e-mail, sort by name or role, 10/20/50 per page.

- **Add New People**: "Email or Name" + a role. An e-mail or the exact name of an account gives
  the role at once (all chapters, any period). An e-mail without an account becomes an
  **invite**: stored, e-mailed, and applied when that e-mail signs in (see Invites below). A name
  that matches no account or several accounts is refused. While typing (2+ characters, 300 ms
  after the last key) up to 8 accounts whose e-mail or name starts with the text are suggested
  (`findPeople`, `users.edit`); arrow keys + Enter or a click picks one (its e-mail is used).
- The **pencil** opens the person popup: status, last sign-in, sign-in methods (read on open),
  the roles (remove with ×, add with "Add more roles", then Save) and Deactivate / Reactivate.
  Roles given for one chapter, unit or period, or by an appointment, are shown without × (they
  are changed where they come from). An invite's popup has "Cancel invite".

**Edit Role** (`/roles/edit`, `roles.read` / `roles.edit`): every role with its colour and
permissions. **Add New Role** and the pencil open the role popup: name, preview, colour (10
fixed colours) and permissions: the chosen ones as chips (× removes) and the "Add more
permissions" dropdown, which holds a search box and checkboxes per admin page: the page (e.g.
"Audit Log") and below it its permissions ("Audit Read", "Audit Edit", "Audit Revert"). Ticking
the page gives all its permissions and disables the single boxes; ticking a single permission
disables the page box. The search keeps a page whose name matches with all its permissions,
otherwise only the matching permissions. A role that has every permission of a page opens with
the page ticked (`splitPermissions` / `joinPermissions` in the model). The bin deletes a custom role
that nobody holds (soft delete). Built-in roles (`superadmin`, `member`, `user`) are read-only.

## Where it lives

- Pages: `src/app/(panel)/roles/page.tsx` (people), `src/app/(panel)/roles/edit/page.tsx`
  (roles), server actions `src/app/(panel)/roles/actions.ts`.
- UI: `src/components/role-manager-page.tsx`; pure rules (rows, tabs, search, badge text
  colour, permission groups) `src/components/role-manager-model.ts`.
- Rules: `src/server/accounts.ts` (`createAccountActions`: give/remove role, status, Add New
  People and its suggestions, cancel invite, person details), `src/server/roles.ts` (`createRoleActions`), wired in
  `src/server/wiring.ts` (the invite e-mail goes through `messenger()`).
- Data: `@website/db` → `createSqlAccountStore` (`listRoleHolders`, `findByName`,
  `searchByPrefix`,
  `invite`, `cancelInvite`, `listInvites`), `createSqlRoleStore`, `createSqlUserStore`
  (`recordSignIn` applies invites) — `packages/db/docs/database.md`.
- Colours: `ROLE_COLORS` / `DEFAULT_ROLE_COLOR` in `@website/permissions` (display only).
- Tests: `tests/integration/users-and-roles.test.ts`, `tests/unit/admin-role-manager.test.ts`,
  `tests/unit/permissions.test.ts`.

## Rules and assumptions

- Escalation, superadmin-only superadmin, last superadmin and "not yourself" rules:
  `packages/permissions/docs/authorization.md`. They apply to invites too.
- Staff roles need two sign-in methods on the account (MFA factor, or passkey + Google/password).
  The person adds a passkey on web → Your account.
- Every change needs a sign-in in the last 15 minutes ("Sign in again" link otherwise), is
  written with its audit entry in one transaction (`module` `users` / `roles`, not revertible),
  then ends the account's sessions (`revokeRefreshTokens`) and logs `staff.role_changed`.
  Deactivation also disables the Firebase Auth account.
- Chapter isolation (A2): with `users.read` for some chapters only, the list shows only accounts
  whose `chapterId` is one of them and no invites; the person popup opens only for such an
  account. Giving or removing roles, invites and (de)activating need `users.edit` globally.
- Concurrent edits: each change sends the version it showed; a stale version → "changed by
  someone else". The popup's Save runs one action per role change, in order.

## Invites

- `invites/{sha256(e-mail)}`: `email`, `roleIds` (still to give), `status`
  (`pending` / `accepted` / `cancelled`), `invitedBy`, `version`, timestamps. Never deleted.
- Applied in `recordSignIn` (website session, every sign-in) only for a **verified** e-mail.
  Roles without admin pages apply at once; staff roles only when the account has two sign-in
  methods (asked only then), otherwise they wait for a later sign-in. Each application is
  audited (actor `system`, module `users`). A deleted role or one already held is dropped.
- The e-mail (Indonesian / English) links to `WEB_URL/login`; key
  `invite:<id>:<version>` (one e-mail per invite change). Failed e-mails show on Messages.

## Configuration

`WEB_URL` (link in the invite e-mail) and messaging (`apps/admin/docs/messaging.md`).
