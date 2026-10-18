# Admin page pattern

## What it does

Every CMS and management page in admin is built the same way, so staff meet the same list,
form and confirmation everywhere (Figma flowchart sections 3–5): a **list page** (filters,
status chips, "Load more", row links, floating **Add** button), **one form** for add and edit
(invalid fields turn red and show their message, success goes back to the list), and a
**confirmation** for destructive actions ("Move to trash" — records are soft-deleted, DEC-16).

## Where it lives

| Part                                | File                                                                  |
| ----------------------------------- | --------------------------------------------------------------------- |
| Table, pagination                   | `src/components/ui/data-table.tsx`                                    |
| Status chip                         | `src/components/ui/badge.tsx` (`Badge`)                               |
| Floating Add button                 | `src/components/ui/fab.tsx` (`Fab`)                                   |
| Field message (red field)           | `src/components/ui/field-error.tsx` (`FieldError` + `aria-invalid`)   |
| Confirm dialog                      | `src/components/ui/confirm-dialog.tsx` (`ConfirmDialog`)              |
| Action error text (+ sign in again) | `src/components/action-error.tsx`, `src/components/action-message.ts` |
| Labels for stored keys (ID + EN)    | `src/labels.ts` (test: `tests/unit/admin-labels.test.ts`)             |
| Mutations                           | `src/server/guarded-action.ts` (`createGuardedAction`)                |
| Reference implementation            | Users and Roles pages (`src/app/(panel)/{users,roles}`)               |

The presentational parts stay in admin's own UI kit (`src/components/ui`, no data access),
next to the existing components, rather than in `packages/ui`: only admin uses them.

## How to use it

```text
src/app/(panel)/things/page.tsx          list   (server component, requireAdminViewer + can)
src/app/(panel)/things/[id]/page.tsx     add/edit ("new" = add), loads the record + version
src/app/(panel)/things/thing-form.tsx    "use client" form: calls the server actions
src/app/(panel)/things/actions.ts        "use server": run the guarded action, revalidatePath
src/server/things.ts                     createGuardedAction(...) definitions (rules + audit)
```

```tsx
// list page
const page = await adminReads.listThings({ status, cursor, limit: 25 });
<DataTable rows={page.items} rowKey={(r) => r.id} columns={[
  { key: "title", header: "Title", render: (r) => <a href={`/things/${r.id}`}>{r.title}</a> },
  { key: "status", header: "Status", render: (r) => <Badge>{label(THING_STATUS_LABELS, r.status)}</Badge> },
]} />
{page.nextCursor ? <Button href={`/things?cursor=${page.nextCursor}`}>Load more</Button> : null}
{can(viewer.principal, "things.edit") ? <Fab href="/things/new" label="Add" /> : null}

// form (client)
const result = await saveThingAction({ ...values, version });
if (!result.ok) { setFields(result.fields ?? {}); return setError(actionMessage(result)); }
router.push("/things"); router.refresh();
<input aria-invalid={fields.title ? true : undefined} aria-describedby="title-error" … />
<FieldError id="title-error" message={fields.title} />
<ConfirmDialog open={confirming} title="Move this thing to trash?" onConfirm={remove} onCancel={close}>…</ConfirmDialog>
```

## Rules and assumptions

- Server actions are thin: every rule, permission and audit entry is in the guarded action.
  `invalid_input` results carry `fields` (first message per field) for red fields; `refused`
  carries a message for staff; `reauthenticate` shows the "Sign in again" link.
- Forms send the `version` they showed; a stale version returns `conflict`.
- Every status, category or action key shown to staff has a label in `src/labels.ts` (Indonesian
  and English); the label test fails when one is missing or stale.
- Dates are shown in UTC on the server (`src/components/format.ts`).
- `DataTable` options: `minRows` keeps the table height fixed with blank rows, `emptyState`
  replaces the empty message, `expandedRow` renders a detail row under a row (the caller owns
  the open/closed state).
- **UI-only pages.** Events, Gallery, Newsletter, Organizations, Account, Emails,
  Profile and the Tools short-link list are design ports that run on `src/data/mock/*` in the
  browser: nothing is saved and nothing is audited. When a feature gets its backend, replace
  its mock import with a server read and its buttons with guarded actions (pattern above), then
  delete the mock file. Articles (`packages/domain/docs/content.md`), Audit Log and Users/Roles
  are the real, data-backed pages.

## Configuration

None.
