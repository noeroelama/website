# Organisation: chapters (PPI Negara), the map, board periods and structure

## What it does

Staff keep the list of member councils (PPI Negara) on the admin **Organizations → PPI** tab:
name, country, time zone, logo, public contact person, website, e-mail, Instagram and other
links, and the marker position on the map. The national board also notes, for the admin list
only, the chapter's member count, up to 5 conditions (e.g. "Belum ada pengurus inti yang
tercatat") and a risk rating ("At risk of a vacuum" chip). Chapters are deleted softly, one at a
time or in bulk ("Select all N ppis"). The website
shows the active chapters on `/map` (Asia–Oceania dot map, one marker per chapter; a click shows
its card) and lists the same chapters with their count on About.

Board periods (kepengurusan, feature A1) are kept on the **Organizations → Period** tab. The form
has only the period (its years, e.g. 2026-2027) and the cabinet; the start and end dates come from
the years (1 January of the first, 31 December of the last). Vision, mission and the LPJ deadline
are still stored (from the import; new periods get empty notes and 30 days). A new period is a
draft; **Set as Active** makes it the active period and archives the one that was active;
**Delete Period** deletes any period but the active one. **Manage Structure** opens the period's
units (`/organizations/periods/[id]`, feature A5) with how many people each shows. **Add New Unit**
and Edit open the unit page (`…/units/new`, `…/units/[unitId]`): name, code, type, the core members
and the divisions with their members (name, role, Head/Member, photo; drag the handle to reorder).
These members are display data for the cabinet page only — not accounts and not RBAC roles.

## Where it lives

- Rules and form schema: `packages/domain/src/organizations/index.ts` (`Chapter`,
  `ChapterInputSchema`, `CHAPTER_RISKS`, `mapPosition`, `toPublicChapter`)
- Database: `packages/db/src/sql/chapters.ts` (`chapters/{id}`, slug index
  `chapterSlugs/{slug}`, built on `slugged.ts`; `createSqlChapterReader` for the web)
- Admin: `apps/admin/src/server/chapters.ts`, `src/components/chapter-form.tsx`, the PPI tab in
  `src/components/organizations-page.tsx`, rows in `chapters-model.ts`
- Web: `apps/web/src/server/chapters.ts`, `src/app/map/…`, About `src/app/about/page.tsx`, map
  image `apps/web/public/map/asia-oceania.svg` (from PPIDK)
- Periods: `Period`, `PeriodFormSchema`, `periodDatesFromName`, `canChangePeriod`,
  `canActivatePeriod`, `canDeletePeriod` in the same domain file; database `packages/db/src/sql/periods.ts`
  (`periods/{id}`, `settings/activePeriod`); admin `apps/admin/src/server/periods.ts`, the Period
  tab in `organizations-page.tsx`, rows in `periods-model.ts`
- Structure: `OrgUnit`, `OrgUnitInputSchema`, `UnitMemberSchema`, `UnitDivisionSchema`,
  `unitPeopleCount`, `placeOrgUnit`, `assertNoCycle`, `movedPath`, `orgUnitPath`, `inTreeOrder` in
  the same domain file; database
  `packages/db/src/sql/org-units.ts` (`orgUnits/{id}`, code index
  `orgUnitCodes/{periodId}_{code}`); admin `apps/admin/src/server/org-units.ts`,
  `src/app/(panel)/organizations/periods/[id]/page.tsx`, `src/components/org-structure-page.tsx`,
  the unit page `periods/[id]/units/{new,[unitId]}/page.tsx` + `src/components/org-unit-editor.tsx`,
  rows in `org-units-model.ts`
- Tests: `tests/unit/chapters.test.ts`, `tests/integration/chapters.test.ts`,
  `tests/integration/periods.test.ts`, `tests/integration/org-units.test.ts` (reverts through
  `tests/support/revert.ts`)

## Rules and assumptions

- Every stored field is public except `memberCount`, `conditions` and `risk` (admin only;
  `toPublicChapter` does not copy them). The contact person is entered with the contact details
  the chapter agreed to publish only; nothing private is kept on a chapter. Chapters saved before
  these fields existed read as 0 / none / "none".
- Country: 2-letter ISO code (upper-cased); time zone: IANA name; links http(s); at most 5 other
  links; latitude/longitude in degrees (the marker, e.g. the country's centre).
- `mapPosition(lat, lng)` turns the coordinates into percent of the map box. The map is
  equirectangular; the constants are fitted to the PPIDK map (Astana, Tokyo, Wellington).
- One reader list (`listActive`) drives the markers, the About list and the count, so they never
  disagree; inactive chapters are hidden everywhere on the site.
- Permission `organizations.edit` (global) to add, edit and delete;
  `organizations.read` to see the page. A chapter admin (`organizations.edit` for one chapter)
  edits only that chapter's contact person, public contact, website, e-mail, Instagram and links;
  name, country, time zone, logo, URL, map position, member count, conditions and risk stay with
  the national board (refused on the server, disabled in the form). Audit module `organizations`,
  resource `chapter`; revertible for 14 days except edits that changed the URL.
- Delete (chapters, periods, units) is soft: `deletedAt` is set, the item leaves the admin lists
  and the website at once, and reverting the DELETE entry in the Audit Log within 14 days brings
  it back. URL slugs and unit codes stay reserved meanwhile.
- The gateway JSON (`/v1/chapters`, the "KSK API" in the flowchart) is not built until the owner
  confirms who uses it.
- The events list will get its country filter from these chapters once events carry a chapter.
- Periods: draft → active → archived. Exactly one period is active: activation is one
  transaction that reads `settings/activePeriod`, archives that period, activates the draft and
  points `settings/activePeriod` to it (concurrent activations are serialized by it). Only a
  draft can be activated; archived periods are read-only; the active period cannot be deleted,
  and a deleted period cannot be activated or edited.
- When the years in the name change, the dates follow them; when only the cabinet changes, the
  stored dates are kept (e.g. imported dates such as 2026-11-01).
- Role assignments with a `periodId` count only while that period is active
  (`packages/permissions/docs/authorization.md`), so activating a period switches the board's
  period-bound roles at once.
- Permission `periods.edit` to add, edit, activate and delete (admin page `periods`, shown as the
  Period tab of Organizations); `periods.read` to see the tab. Audit module `periods`, resource
  `period`; only DELETE entries are revertible (a revert of an edit could bring back a second
  active period).
- Units belong to one period (PPIDK: the structure is rebuilt per period) and store `parentId`
  and `path` (ancestor ids, root first). "Every unit below X" is one
  `where("path", "array-contains", X)` query. A resource in a unit passes
  `orgUnitPath(unit)` (ancestors + itself) as `ResourceContext.orgUnitPath`, so a role scoped to
  a unit covers the unit and everything below it.
- Save never changes where a unit sits; **Move** does, in one transaction that rewrites the
  `path` of the whole subtree (at most 400 units; a period has a few dozen). A move into the
  unit itself or below it is refused. Each write reads the period and the parent in the same
  transaction: the parent must be a live unit of the same period, and an archived period's
  structure is read-only.
- The code is upper-cased and unique per period. New units from the unit page sit at the top
  level; units imported under a parent keep their place (Move has no button in the redesign).
- A unit keeps at most 50 core members and 30 divisions of at most 50 members each, in display
  order. Photos use the public upload preset `cabinet` (`structure.edit`).
- A unit is deleted only when no live unit sits below it and nobody holds an active appointment
  in it (those would keep roles scoped to a deleted unit); an archived period's units are
  read-only.
- Appointments (B7, account-based roles) still exist in the data and the import, but the
  redesigned Structure page no longer shows them; see `packages/permissions/docs/authorization.md`.
- Permission `structure.edit` to add, edit and delete (admin page `structure`);
  `structure.read` to see the list. Audit module `structure`, resource `orgUnit`; only DELETE
  entries are revertible (a revert of an edit would not rewrite the paths below the unit).

## Configuration

Logo and member-photo uploads need `FILE_STORAGE_DIR`.
