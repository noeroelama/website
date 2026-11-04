# Admin page pattern

## What it does

Every CMS and management page in admin is built the same way, so staff meet the same list,
form and confirmation everywhere (Figma flowchart sections 3–5): a **list page** (filters,
status chips, "Load more", row links, an **Add New …** button in the page header), **one form**
for add and edit (each field shows its requirements, success goes back to the list), and a
**confirmation** for destructive actions ("Move to trash" — records are soft-deleted, DEC-16).
Every page has the same dark look: the same popup, table, fields, labels, text and colours.

## Where it lives

| Part                                | File                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------- |
| Table, pagination, sort header      | `src/components/ui/data-table.tsx`                                         |
| CSV download                        | `src/components/csv.ts`                                                    |
| Status chip                         | `src/components/ui/badge.tsx` (`Badge`)                                    |
| Field feedback (requirements)       | `src/components/ui/field-error.tsx` (`FieldError`)                         |
| Dropdown (Newsletter status menu)   | `src/components/ui/select.tsx` (`Select`, search over 5 options)           |
| Field and dropdown rules            | `src/components/fields-model.ts` (test: `tests/unit/admin-fields.test.ts`) |
| Popup                               | `src/components/ui/modal.tsx` (`Modal`)                                    |
| Dark look (all pages)               | `src/app/globals.css` "Dark admin pages"                                   |
| Confirm dialog                      | `src/components/ui/confirm-dialog.tsx` (`ConfirmDialog`)                   |
| Dark list page parts                | `src/components/ui/list-controls.tsx` (`ListCard`, `useListTable`, …)      |
| Dark list page rules                | `src/components/list-model.ts` (test: `tests/unit/admin-list.test.ts`)     |
| Rich text editor (type boxes)       | `src/components/ui/rich-text-box.tsx` (`RichTextStack`)                    |
| Action error text (+ sign in again) | `src/components/action-error.tsx`, `src/components/action-message.ts`      |
| Labels for stored keys (ID + EN)    | `src/labels.ts` (test: `tests/unit/admin-labels.test.ts`)                  |
| Mutations                           | `src/server/guarded-action.ts` (`createGuardedAction`)                     |
| Reference implementation            | Role Manager (`src/app/(panel)/roles`)                                     |

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
// header actions: {can(viewer.principal, "things.edit") ? <Button href="/things/new" variant="outline" size="sm" icon="plus">Add New Thing</Button> : null}

// form (client)
const result = await saveThingAction({ ...values, version });
if (!result.ok) { setFields(result.fields ?? {}); return setError(actionMessage(result)); }
router.push("/things"); router.refresh();
<div className="admin-field">
  <label className="admin-field__label" htmlFor="title">Title *</label>
  <input id="title" className="admin-input" required minLength={2} … />
  <FieldError id="title-error" message={fields.title} hint="Shown on the public page" />
</div>
<Select id="type" className="admin-select" value={type} onChange={…}>{options}</Select>
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
- **Look.** `.admin-dark-page` is on the content area (`src/components/admin-sidebar.tsx`), so
  every page and popup is dark; pages do not add their own theme. Colours that depend on the
  surface are CSS variables (`--admin-ink`, `--admin-field-bg`, `--admin-btn-bg`, `--admin-error`,
  …): cream fields and buttons on the dark canvas, dark ones on cream surfaces (cards, rows,
  menus — the list is at the top of "Dark admin pages"; add a new cream surface there).
  Solid buttons (`primary`, `outline`) are cream, `danger` is red. Popups use `Modal` without a
  theme class: big title, fields, then **Back** (`outline`, `chevronLeft`) and the action at the
  bottom right (`ConfirmDialog` does this for confirmations). Every popup is centred on the page;
  `className="admin-modal--side"` only makes it a cream surface (Article Settings, Role Manager).
  A test (`tests/unit/design-tokens.test.ts`) fails if a popup rule moves it off centre.
- **Fields.** Put each control in `.admin-field` with a label and a `FieldError` last. Declare
  the rules on the control with HTML attributes — `required`, `type` (`email`, `url`, `number`),
  `minLength`, `min`/`max`, `pattern` + `title` (the text shown) — mirroring the domain schema.
  The border lights up gold while typing. After the field is left (or a submit finds it invalid),
  `FieldError` lists the requirements: a red triangle while unmet (red border too), a green tick
  once met; it updates while typing. A server message (`message`) shows until the value is
  edited; `hint` is help text shown before that. The server still checks everything.
- **Dropdowns.** Use `Select` instead of `<select>` (same props and `<option>` children). With
  more than 5 options it opens a list with a search box (case and accents ignored); the native
  select stays hidden in the page, so `name`, `onChange`, `required` and GET forms still work.
  A custom dropdown panel (e.g. Role Manager's permission checkboxes) uses the same `useDropdown`
  hook (fixed to the window above popups, closes on a click outside). An open dropdown that
  handles Escape calls `preventDefault()`, so `Modal` stays open.
- `DataTable` options: `emptyState` replaces the "no results" message (shown under the header,
  centred in the table), `expandedRow` renders a detail row under a row (the caller owns the
  open/closed state). `Pagination` offers 10 / 20 / 50 rows unless `pageSizeOptions` is given.
- **Table height.** Put a table in `<Card className="admin-list-card">` (`ListCard` does this):
  the card fills the rest of the screen height, and grows with the page when its rows need more
  room. No fixed heights or blank rows; the CSS is "A page with a table fills the screen height"
  in `globals.css` (test: `tests/unit/design-tokens.test.ts`, "admin tables").
- **Table width.** Cell text wraps onto the next line between words, and the line under a title
  (`.admin-table__sub`: links, e-mails) breaks anywhere, so a table is never wider than its card
  and never scrolls sideways. Do not add `white-space: nowrap`, ellipsis or a `min-width` to
  table rules (same test).
- **Tabs.** Every tab row is `Tabs` (`ui/list-controls.tsx`). It scrolls sideways with no
  scrollbar (touch, trackpad, or mouse drag; a drag does not select a tab), its tabs stay inside
  its height, and its end fades into the background (`.admin-tabs`, test "admin tabs"). Page CSS
  may change gaps and margins, not the row's overflow.
- **Scrollbar.** Every scrollbar (page, side panel, popups, menus, tables, code blocks) is a slim
  rounded thumb on a transparent track (`*::-webkit-scrollbar` in `globals.css`, test "admin
  scrollbar"); the tab row has none (see Tabs). Only the page reserves its gutter
  (`html:has(.admin-dark-page)`, `scrollbar-gutter: stable`), so content keeps its width when a page
  becomes long enough to scroll.
- **Phone cards** (up to 767px). Every `DataTable` row becomes a cream card; the CSS is the block
  between `Mobile list cards: begin/end` in `globals.css` (test "admin tables on a phone").
  `DataTable` puts `data-card` on each cell (`cardRoles` in `list-model.ts`, by column key: `check`
  / `expand` lead, `aksi` / `actions` / `edit` / `open` / `revert` are the action row, the first
  other column is the title, the rest are detail lines) and `data-label` (the header text) so a
  detail line reads "Label value". The header row is hidden: `ListCard` adds a summary line
  ("112 events · Newest first", **Select** / **Unselect** / **Select all**), and `SortMenu`
  (page header, next to the search box; its entries come from the `SortHeader` columns) is the
  sort button.
  Wrap the header's Add / Export buttons in `<div className="admin-fab">` (a plain wrapper on a
  wide screen, floating bottom right on a phone). Row menus (`RowMenu`) stay in the page, so on a
  phone their entries are the card's labelled buttons (Delete first); an icon button gets its
  label from its `title`. A menu entry with `admin-row-menu__item--wide` / `--phone` shows only
  on a wide screen / a phone (Event: Publish + Make Private vs one Visibility), and a
  `<span className="admin-long">` part of a label is dropped on a phone ("Delete Event" → "Delete").
  The bulk bar is fixed at the bottom; `Pagination` shows Prev / page /
  Next. Adding a page: use `ListCard` or `DataTable`, give columns these keys, and wrap its header
  buttons.
- **Dark list pages** (Event, Gallery, Article, Newsletter, Audit Log) share one set of parts —
  add a new list page with them instead of copying markup:
  - `useListTable(rows, sortValue, initialSort?)`: sort, page, page size and row selection. Define
    `sortValue` outside the component so the sorted list is only rebuilt when rows or sort change.
  - `useBulkActions({ noun, show })`: runs one server action per selected row (stops at the first
    refusal), refreshes the page and shows "3 events deleted".
  - `ListCard`: card with the optional filter panel, the table, then the bulk bar (rows selected)
    or the pagination. `ListEmpty` is its "no results" message with **Clear Filters** / **Add**.
  - `SearchBox` (keeps its own text until **Search**/Enter — change its `key` to clear it),
    `FiltersButton`, `Tabs`, `SelectCheckbox`, `RowMenu` + `MenuItem` + `MenuDivider` (the `⋯`
    menu keeps its own open state and closes when an item is clicked).
  - `ConfirmDialog` takes an `icon`; `DELETE_HINT` is the shared "you can revert it" text.

  Typing in the search box or opening a row menu re-renders only that part, not the whole table.

- **Rich text** (Article body, Newsletter campaign): `RichTextStack` edits a list of type boxes
  (add, delete, drag to reorder, format toolbar, links, inline images through `uploadImage`;
  `readOnly` for sent campaigns). Save the HTML with `joinBlocks(blocks)`.
- **Dashboard** (`/`, every staff member): counters for events, albums, news articles and
  confirmed subscribers — each only when the viewer can read that page (`COUNT` queries,
  `src/server/dashboard.ts`, `packages/db/src/sql/dashboard.ts`) — and the 10 newest
  audit entries with `audit.read`. Tests: `tests/integration/dashboard.test.ts`.
- **UI-only pages.** The Tools short-link list is a design port that runs on `src/data/mock/*` in the
  browser: nothing is saved and nothing is audited. When a feature gets its backend, replace
  its mock import with a server read and its buttons with guarded actions (pattern above), then
  delete the mock file. Articles (`packages/domain/docs/content.md`), Events
  (`packages/domain/docs/events.md`), Gallery (`packages/domain/docs/gallery.md`), Newsletter
  (`packages/domain/docs/newsletter.md`), Forms (`packages/domain/docs/forms.md`), Audit Log and
  Role Manager are the real, data-backed pages.
- **Letters** (`/letters`, `src/components/letters-page.tsx`, model `letters-model.ts`): tabs
  per desk (Drafts, To correct, To sign, To issue, Issued, Cancelled), the write/edit form and a
  detail view with only the buttons the viewer's desks allow (`letterActions`); **Letter types**
  at `/letters/types`. **Incoming letters** (`/incoming`, `incoming-page.tsx`, model
  `incoming-model.ts`): agenda book, scan, disposition chain. Rules:
  `packages/domain/docs/documents.md`.
- **OKR** (`/okr`, `src/components/okr-page.tsx`): one period (`?period=`), its vision and
  mission, objectives with key results and achievement; popup forms share
  `src/components/program-ui.tsx` (`FormModal`, `Field`, `ChoiceField`, `PeriodSwitch`). Rules:
  `packages/domain/docs/programs.md`.
- **Programmes** (`/programs`, `src/components/programs-page.tsx`; one programme at
  `/programs/[id]`, `program-page.tsx`): list per period, the plan form (budget lines typed as
  "JPY 50000", PICs by e-mail), workflow buttons the viewer may use, milestones (tick = done),
  health and weekly check-ins. **LPJ** (`/lpj`, `/lpj/[id]`, `src/components/lpj-page.tsx`): the
  period's LPJs (overdue in red), one LPJ with the frozen plan, the PICs' form, the desks and the
  PDF link (`/api/lpj/[id]/pdf`). The dashboard warns when nobody holds the LPJ secretariat desk.
  **Report card** (`/programs/report?period=`, server-rendered): OKR achievement, programme
  completion, LPJ counts and budget absorption per currency, computed on request.
- **Finance** (`/finance`, `finance-page.tsx`, model `finance-model.ts`): requests of the active
  period with tabs (Drafts, At a desk, To pay, Paid and done, Rejected), the form, documents and
  proof uploads (`/api/finance/[id]/files`), and only the desk buttons the viewer holds on other
  people's requests (`financeActions`). Rules: `packages/domain/docs/finance.md`.
- **Tools** (`/tools`, `src/components/tools-page.tsx`): QR Generator and URL Shortener in cream
  cards on the dark page (layout scoped to `.admin-tools` in `globals.css`; fields and buttons
  follow the cream-surface colours). Links
  are shown without their scheme (`withoutScheme` in `src/components/format.ts`); the link list
  has no header row, so its column widths live in CSS. The QR Generator follows the shared QR
  rules (`@website/domain/documents` → `qr.ts`, see `packages/domain/docs/documents.md`): at
  most 800 characters, high error correction, 4-module quiet zone, downloads at 300 / 600 /
  1000 px, the logo only on the PNG on an opaque plate, never in the SVG. It runs in the
  browser (nothing is stored). The short links still use mock data (step 7.5). Tests:
  `tests/unit/admin-tools.test.ts`.

## Configuration

None.
