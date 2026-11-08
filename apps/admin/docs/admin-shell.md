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
  `primary` buttons are champagne gold (`--color-highlight`, also the active nav item and
  focus ring), `outline` is cream, `danger` is red. Popups use `Modal` without a
  theme class: big title, fields, then **Back** (`outline`, `chevronLeft`) and the action at the
  bottom right (`ConfirmDialog` does this for confirmations). Every popup is centred on the page;
  `className="admin-modal--side"` only makes it a cream surface.
  A test (`tests/unit/design-tokens.test.ts`) fails if a popup rule moves it off centre.
- **Form popups** are built like Article Settings: pass `asForm` (no `className`, `width` or
  `hideClose`) and `Modal` makes the body and footer one `<form>` on the cream surface, 548px
  wide, without the X. Each field is `.admin-field` with a `<label htmlFor>` above the control
  (not a `<label>` wrapped around it); pairs go in `.admin-form-grid`. The footer is
  `.admin-modal__footer-row`: **Back** (`outline`, `chevronLeft`) and one
  `type="submit" variant="primary"` button with an icon. Give the submit button the work in
  `onClick`, or, for a form read with `FormData`, pass `onSubmit` to `Modal` (no inner `<form>`).
  Test "admin form modals" checks every popup that has fields.
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
  For a pill with a label (Audit Log's Date range, User, Action), pass `prefix` and the pill class
  as `className` (with an `aria-label`): the whole pill is the button. Don't wrap `Select` in a
  `<label>`, because clicks on the label text go to the hidden native select. In the right half
  of the window the panel lines up with the button's right edge.
  A custom dropdown panel (e.g. Role Manager's permission checkboxes) uses the same `useDropdown`
  hook (fixed to the window above popups, closes on a click outside). An open dropdown that
  handles Escape calls `preventDefault()`, so `Modal` stays open.
- `DataTable` options: `emptyState` replaces the "no results" message (shown under the header,
  centred in the table), `expandedRow` renders a detail row under a row (the caller owns the
  open/closed state). `Pagination` offers 10 / 25 / 50 rows unless `pageSizeOptions` is given.
- **Table height.** Put a table in `<Card className="admin-list-card">` (`ListCard` does this):
  the card fills the rest of the screen height, and grows with the page when its rows need more
  room. No fixed heights or blank rows; the CSS is "A page with a table fills the screen height"
  in `globals.css` (test: `tests/unit/design-tokens.test.ts`, "admin tables").
- **Table width.** Cell text wraps onto the next line between words, and the line under a title
  (`.admin-table__sub`: links, e-mails) breaks anywhere, so a table is never wider than its card
  and never scrolls sideways. Do not add `white-space: nowrap`, ellipsis or a `min-width` to
  table rules (same test).
- **Control height.** Buttons (every size), fields, dropdowns (`Select`), the URL slug box and
  the search box are one height: `--admin-control-height` in `globals.css` (34 px, 40 px under
  768 px). Do not set a control's height elsewhere (test "admin controls" in
  `tests/unit/design-tokens.test.ts`). Icon buttons, the editor toolbar and the pagination bar
  keep their own compact sizes.
- **Motion and overflow** (`globals.css`, section "Motion"; tests "admin motion and overflow" in
  `tests/unit/design-tokens.test.ts`):
  - Page change: React's `<ViewTransition>` wraps `<main>` (`admin-sidebar.tsx`), so a
    navigation crossfades the old page into the new one; the side panel stays still. Anything
    that runs as a transition (e.g. `router.refresh()` after saving) fades the same way. No
    fade with reduced motion, or in browsers without the View Transitions API.
  - Buttons: flat (no inset lines, shadow or glow); a press scales with `--admin-ease-spring`.
  - Popups (modal, row menu, dropdown, account menu, link popover) start from opacity 0 and
    scale 0.9 (`@starting-style`); every scrolling box has `overscroll-behavior: contain`.
    Dropdown buttons press like buttons (scale 0.96) and their arrow turns over while open.
  - Menu items, dropdown options and table rows come in one after another: give each a
    `style={{ "--i": index }}` (RowMenu does this for its entries).
  - Note fields (`<textarea>`) grow with their text (listener in `admin-sidebar.tsx`).
  - A flex item that grows (`flex: 1`) also gets `min-width: 0`; on phones long words break
    anywhere.
- **Publish** buttons and menu items show the minimal line globe with the word (`icon="globeSimple"`,
  label "Publish"), in forms, bulk bars, row menus and the Newsletter publish dialog.
- **No emoji.** Use `Icon` (`ui/icon.tsx`) or words instead (test "admin text" in
  `tests/unit/design-tokens.test.ts`).
- **Tabs.** Every tab row is `Tabs` (`ui/list-controls.tsx`). It scrolls sideways with no
  scrollbar (touch, trackpad, or mouse drag; a drag does not select a tab), its tabs stay inside
  its height, and its end fades into the background (`.admin-tabs`, test "admin tabs"). Page CSS
  may change gaps and margins, not the row's overflow. Hover changes only a tab's colour (only the
  active tab is bold), so tabs never change width on hover.
- **Scrollbar.** Every scrollbar (page, side panel, popups, menus, tables, code blocks) is a slim
  rounded thumb on a transparent track (`*::-webkit-scrollbar` in `globals.css`, test "admin
  scrollbar"); the tab row has none (see Tabs). Only the page reserves its gutter
  (`html:has(.admin-dark-page)`, `scrollbar-gutter: stable`), so content keeps its width when a page
  becomes long enough to scroll. Cream menus and dropdowns (`.admin-row-menu__panel`) use a dark
  thumb instead, because the light one does not show on cream.
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
  phone their entries are the card's buttons, icon over label, in one row of equal 44 px
  buttons: Delete (or `admin-table__delete`) far left, the row's own icon buttons (Edit) far
  right in thumb reach; an icon button gets its label from its `title`. Card text is 12 px or
  more (no `--text-2xs`), the title is 16 px semibold (two lines at most), the checkbox has a
  44 px hit area, and a selected card gets a dark ring. A menu entry with `admin-row-menu__item--wide` / `--phone` shows only
  on a wide screen / a phone (Event: Publish + Make Private vs one Visibility), and a
  `<span className="admin-long">` part of a label is dropped on a phone ("Delete Event" → "Delete"); keep phone labels to one or two short words.
  The bulk bar is fixed at the bottom; `Pagination` shows Prev / page /
  Next. Adding a page: use `ListCard` or `DataTable`, give columns these keys, and wrap its header
  buttons.
- **Dark list pages** (Event, Gallery, Article, Newsletter, Audit Log) share one set of parts —
  add a new list page with them instead of copying markup:
  - `useListTable(rows, sortValue, initialSort?, filterText?)`: sort, column filters, page, page
    size and row selection. Define `sortValue` and `filterText` (a cell's text in its column's
    checklist; default the sort value) outside the component. `table.header(key, label)` is a
    sortable column's header: the filter icon opens **Sort A to Z / Z to A** and a checklist of the
    column's values (`ui/column-menu.tsx`). There is no Filters button; on a phone `SortMenu` shows
    the same menus as a row of chips under the search box.
  - `useBulkActions({ noun, show })`: runs one server action per selected row (stops at the first
    refusal), refreshes the page and shows "3 events deleted".
  - `ListCard`: card with the table, then the bulk bar (rows selected) or the pagination; its
    count is the rows left after the tab, search and column filters (`table.sorted`). `ListEmpty` is its "no results" message with **Clear Filters** / **Add**.
  - `SearchBox` (keeps its own text until **Search**/Enter — change its `key` to clear it),
    `Tabs`, `SelectCheckbox`, `RowMenu` + `MenuItem` + `MenuDivider` (the `⋯`
    menu keeps its own open state and closes when an item is clicked).
  - `ConfirmDialog` takes an `icon`; `DELETE_HINT` is the shared "you can revert it" text.

  Typing in the search box or opening a row menu re-renders only that part, not the whole table.

- **Rich text** (Article body, Newsletter campaign): `RichTextStack` edits a list of type boxes
  (add, delete, drag to reorder, format toolbar, links, inline images through `uploadImage`;
  `readOnly` for sent campaigns). Save the HTML with `joinBlocks(blocks)`.
- **Dashboard** (`/`, every staff member) shows only what needs the viewer, in this order, and
  hides a section when it is empty: (1) **action tiles** — one `StatCard` per desk with items
  waiting (finance review/authorise/pay, the three LPJ desks, Zoom approval; items of the active
  period in the units the desk covers that the module's own rule would let this person act on),
  **My overdue tasks** and, with `appointments.edit`, **Graduated officers still in office**; the
  header says how many; (2) **Setup to fix** — missing environment variables (superadmin) and
  "nobody can review LPJs"; (3) **Page views** (superadmin). Counters, latest changes, the 7-day
  agenda and period numbers were removed (they live on their own pages). `src/server/dashboard.ts`;
  tests: `tests/integration/dashboard.test.ts`.
- **Data-backed pages.** No page runs on mock data any more (the Tools short-link list was the
  last, step 7.5). Articles (`packages/domain/docs/content.md`), Events
  (`packages/domain/docs/events.md`), Gallery (`packages/domain/docs/gallery.md`), Newsletter
  (`packages/domain/docs/newsletter.md`), Forms (`packages/domain/docs/forms.md`), Audit Log and
  Role Manager are the real, data-backed pages.
- **Letter** (`/letters`, `letters.read`): one page with the tabs Outgoing and Incoming
  (`?tab=incoming`, needs `incoming.read`), laid out like Newsletter: header (`Letter > Outgoing`)
  with the buttons, the Status dropdown (`StatusMenu`), sort and search, then the tabs, then the
  table. The **Letter types** button opens `?tab=types` (`letter_types.read`; no tab highlighted).
  **Outgoing** (`src/components/letters-page.tsx`, model `letters-model.ts`): dropdown per desk
  (All, Drafts, To correct, To sign, To issue, Issued, Cancelled), **Write letter**, and a detail
  view with only the buttons the viewer's desks allow (`letterActions`). **Incoming**
  (`incoming-page.tsx`, model `incoming-model.ts`): dropdown All, New, Disposed, Done, Archived;
  **Send Mail** records a letter in the agenda book; scan, disposition chain. Rules:
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
  people's requests (`financeActions`); **Cash book** at `/finance/cashbook` (report per currency
  for a date range, manual lines, CSV/PDF from `/api/finance/report`). Rules:
  `packages/domain/docs/finance.md`.
- **Meetings** (`/meetings`, `meetings-page.tsx`; one meeting at `/meetings/[id]`,
  `meeting-page.tsx`): list per period, the schedule form (participants by e-mail with
  `chair`/`secretary`), room link, cancel, the attendance list with manual ticks and the
  **attendance code** screen (code + QR, renewed every 90 s). Rules:
  `packages/domain/docs/meetings.md`.
- **Zoom** (`/zoom`, `zoom-page.tsx`): bookings 30 days back to 180 ahead, the booking form,
  approve/reject, cancel, the invitation with its QR, and Settings (`zoom.settings`). Rules:
  `packages/domain/docs/zoom.md`.
- **Page views** (on the Dashboard, superadmin only — `isSuperadmin`, not a Role Manager
  permission; `src/components/page-views-card.tsx`): like the PPIT statistics page — one chart with
  Daily (last 30 days, line) / Monthly (12 months, bars) / Yearly (5 years, bars), then Total /
  Average. The card header has a page dropdown (All pages + pages viewed in the period) left of the
  Daily / Monthly / Yearly switch (`page-views-controls.tsx`, `.admin-segmented`;
  `?views=…&page=…`). The chart (`page-views-chart.tsx`) draws at its real width, so its text is
  `--text-xs` on every screen; hovering shows a dashed guide line and the date and views of the
  nearest point (`.admin-views__tip`); axis steps and labels come from `page-views-model.ts`. Each
  period tab is as tall as the page dropdown. Dashboard
  card titles are `--text-xl`, one step below the page title. Data: `pageViewStats`
  (`packages/db/src/sql/page-views.ts`), recorded by apps/web (`apps/web/docs/public-site.md`).
  Tests: `tests/integration/page-views.test.ts`, `tests/unit/admin-navigation.test.ts`,
  `tests/unit/admin-page-views.test.ts`.
- **Integration status** (L3, on the Dashboard; the Settings page was removed): superadmins see a
  "Setup to fix" table listing each integration (WAHA, Cloud API, Zoom, Drive,
  Anthropic, short links, calendar feed, Resend) whose variables are missing, with the missing
  names, and a note when `MESSAGING_MODE` is `log`. Never a value (`src/server/settings.ts`,
  `tests/unit/admin-settings.test.ts`). Zoom settings stay on `/zoom` (`zoom.settings`), the
  letterhead on `/letters?tab=types`.
- **Tools** (`/tools`, `src/components/tools-page.tsx`): QR Generator and URL Shortener in cream
  cards on the dark page (layout scoped to `.admin-tools` in `globals.css`; fields and buttons
  follow the cream-surface colours). Links
  are shown without their scheme (`withoutScheme` in `src/components/format.ts`); the link list
  has no header row, so its column widths live in CSS. The QR Generator follows the shared QR
  rules (`@website/domain/documents` → `qr.ts`, see `packages/domain/docs/documents.md`): at
  most 800 characters, high error correction, 4-module quiet zone, downloads at 300 / 600 /
  1000 px, the logo only on the PNG on an opaque plate, never in the SVG. It runs in the
  browser (nothing is stored). The URL Shortener uses goppi.id first and s.id as fallback (`packages/domain/docs/links.md`): create with an optional slug, rename the title, archive/restore, clicks on open. Tests:
  `tests/unit/admin-tools.test.ts`.

## Exports (M8)

CSV is built in the browser from the rows the page already shows (`src/components/exports-model.ts`
→ `downloadCsv`, UTC times, cells quoted with `esc`). Exports of personal data first call a
logging action (`src/server/exports.ts` `createExportLog`, the page's `.read` permission) that
writes a `data.export` security event; the download starts only when it succeeds.

| Export                                   | Where                                 | Logged dataset             |
| ---------------------------------------- | ------------------------------------- | -------------------------- |
| Programmes + milestones (CSV)            | Programmes                            | —                          |
| Period report card (PDF)                 | Report card → PDF                     | —                          |
| Zoom bookings (CSV)                      | Zoom                                  | —                          |
| Meeting attendance (CSV, PDF)            | Meeting → Export CSV / Attendance PDF | `meeting_attendance` (CSV) |
| Applicants (CSV, filtered list)          | Recruitment → Applications            | `applicants`               |
| Accounts + role assignments (CSV)        | Role Manager                          | `accounts`                 |
| Audit by date range (CSV)                | Audit Log (date range filter)         | —                          |
| Form responses, subscribers, cash report | their pages (server-built)            | see their docs             |

Tests: `tests/unit/admin-exports.test.ts`, `tests/integration/exports.test.ts`.

## Configuration

None.
