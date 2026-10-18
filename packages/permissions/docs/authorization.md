# Authorization (RBAC)

## Model

- **Admin pages** (`packages/permissions/src/permissions.ts → ADMIN_PAGES`): every page has
  `<page>.read` and `<page>.edit` (edit includes read). Pages that need more have named extras:

  | Page          | Extras                                     |
  | ------------- | ------------------------------------------ |
  | `registrants` | `export`                                   |
  | `articles`    | `publish`                                  |
  | `newsletter`  | `send`, `export`                           |
  | `members`     | `pii` (personal data), `export`, `approve` |
  | `audit`       | `revert`                                   |
  | `shop_orders` | `refund`                                   |

  Adding a page or an extra is a reviewed code change (the page is code anyway).

- **Roles** are data. Custom roles live in Firestore (`roles/{id}`: name + page permissions) and
  are created and edited in the admin **Roles** page. `normalizePermissions()` cleans every
  saved list (unknown entries dropped, edit/extras add read).
- **Built-in roles** (`SYSTEM_ROLES`, code only, never editable): `superadmin` (every page),
  `member` (approved member), `user` (every account). A stored role with one of these ids is
  ignored.
- **Assignments** in `users/{uid}.roleAssignments`:
  `{ roleId, scope, periodId, source, revokedAt }`. On each request the server resolves them
  against the role documents (`resolveAssignments`); an assignment to a deleted role grants
  nothing.
  - **Scope** (DEC-2): `global`, `{ type: "chapter", chapterId }` (that chapter only) or
    `{ type: "orgUnit", orgUnitId }` (that unit and every unit below it, never its siblings —
    the resource passes its `orgUnitPath`, the ids from the root down to itself).
  - **Period** (B6): `periodId` set = the role belongs to one board period and only counts while
    that period is active (`settings/activePeriod.periodId`, read with the user record in one
    `getAll`). `null` = independent of periods (e.g. superadmin).
  - **Revocation**: an assignment with `revokedAt` grants nothing; it stays for the history.
    `source` is `manual` (Users page) or `appointment` (set by the server from a board
    appointment, never from the client).
  - Unknown scope types, bad ids and unreadable dates are dropped when the record is read.
- **Self-service** permissions (`profile.read_own`, `profile.write_own`, `events.register`,
  `registrations.read_own`, `shop.orders.read_own`) belong to every active account, for its own
  resources only (`ownerId === userId`). They cannot be put on a role.

```ts
can(principal, "events.edit", { chapterId: "jp" });
can(principal, "users.edit", { orgUnitPath: ["board", "media"] }); // unit and descendants
can(principal, "profile.write_own", { ownerId: principal.userId });
canAccessAdmin(principal); // any admin-page permission
canInSomeScope(principal, "audit.read"); // what to SHOW (navigation), never an action check
scopedChapterIds(principal, "users.read"); // "all" | chapter ids: filter list queries by it
requirePermission(principal, "articles.publish");
canSaveRole(principal, draft, previous); // Roles page
canAssignRole(principal, role); // Users page
accountChangeRefusal({ actor, targetUserId, role, superadminsAfter }); // Users page: why not
```

## Rules

- `can()` without a resource answers for a **global** assignment only, so a chapter or unit
  assignment never passes an unscoped check (the PPIDK §56/§73 leak cannot happen here). Lists
  of people are filtered in the repository query with `scopedChapterIds` (A2).
- Evaluated **server-side only**. Never trust hidden buttons, client route guards, client
  state, a Firebase login alone, URL params, or role fields in payloads (tested).
- Every admin mutation uses `createGuardedAction` (staff → validation → permission).
- **No privilege escalation**: saving or deleting a role needs `roles.edit` and every permission
  the role has (and had) in a **global** assignment; assigning a role needs `users.edit` and every
  permission of that role; only a superadmin assigns `superadmin`; built-in roles cannot be saved
  or deleted. Keep 2–3 superadmins; the last active one cannot be demoted or deactivated
  (`accountChangeRefusal`, counted inside the same transaction).
- Nobody changes their own roles or status.
- A role that opens any admin page is only written when the account has **two sign-in methods**
  (`hasTwoSignInMethods` in `@website/auth`: an MFA factor, or a passkey plus Google/password).
- Role changes and deactivation need a sign-in in the last 15 minutes, are audited (not
  revertible: they always go through these rules), revoke the account's sessions and emit the
  `staff.role_changed` security event. Pages: `apps/admin/docs/users-and-roles.md`.
- Third-party API scopes (`events.read`, `registrations.write`) are a separate vocabulary in
  `@website/apikeys`.
