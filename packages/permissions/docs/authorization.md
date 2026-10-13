# Authorization (RBAC)

## Model

- **Admin pages** (`packages/permissions/src/permissions.ts → ADMIN_PAGES`): every page has
  `<page>.read` and `<page>.edit` (edit includes read). Pages that need more have named extras:

  | Page          | Extras                                     |
  | ------------- | ------------------------------------------ |
  | `registrants` | `export`                                   |
  | `articles`    | `publish`                                  |
  | `newsletter`  | `send`                                     |
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
- **Assignments** in `users/{uid}.roleAssignments`: `{ roleId, scope }`, scope `global` or
  `{ chapter }`. On each request the server resolves them against the role documents
  (`resolveAssignments`); an assignment to a deleted role grants nothing.
- **Self-service** permissions (`profile.read_own`, `profile.write_own`, `events.register`,
  `registrations.read_own`, `shop.orders.read_own`) belong to every active account, for its own
  resources only (`ownerId === userId`). They cannot be put on a role.

```ts
can(principal, "events.edit", { chapterId: "jp" });
can(principal, "profile.write_own", { ownerId: principal.userId });
canAccessAdmin(principal); // any admin-page permission
canInSomeScope(principal, "audit.read"); // what to SHOW (navigation), never an action check
requirePermission(principal, "articles.publish");
canSaveRole(principal, draft, previous); // Roles page
canAssignRole(principal, role); // Users page
```

## Rules

- Evaluated **server-side only**. Never trust hidden buttons, client route guards, client
  state, a Firebase login alone, URL params, or role fields in payloads (tested).
- Every admin mutation uses `createGuardedAction` (staff → validation → permission).
- **No privilege escalation**: saving or deleting a role needs `roles.edit` and every permission
  the role has (and had) in a **global** assignment; assigning a role needs `users.edit` and every
  permission of that role; only a superadmin assigns `superadmin`; built-in roles cannot be saved
  or deleted. Keep 2–3 superadmins; the last one cannot be demoted.
- Role changes are audited and emit security events.
- Third-party API scopes (`events.read`, `registrations.write`) are a separate vocabulary in
  `@website/apikeys`.
