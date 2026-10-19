# Organisation: chapters (PPI Negara), the map, board periods and structure

## What it does

Staff keep the list of member councils (PPI Negara) on the admin **Organizations → PPI** tab:
name, country, time zone, logo, public contact person, website, e-mail, Instagram and other
links, and the marker position on the map. A chapter is deactivated, never deleted. The website
shows the active chapters on `/map` (Asia–Oceania dot map, one marker per chapter; a click shows
its card) and lists the same chapters with their count on About.

Board periods (kepengurusan, feature A1) are kept on the **Organizations → Period** tab: name
(2026/2027), cabinet, start and end date, vision, mission and the LPJ deadline (days after the
end). A new period is a draft; **Set as Active** makes it the active period and archives the one
that was active. **Manage Structure** opens the period's unit tree
(`/organizations/periods/[id]`, feature A5): coordinator, secretariat, directorates, bureaus,
fields/divisions and staff, each under its parent unit.

## Where it lives

- Rules and form schema: `packages/domain/src/organizations/index.ts` (`Chapter`,
  `ChapterInputSchema`, `mapPosition`, `toPublicChapter`)
- Firestore: `packages/db/src/firestore/chapters.ts` (`chapters/{id}`, slug index
  `chapterSlugs/{slug}`, built on `slugged.ts`; `createFirestoreChapterReader` for the web)
- Admin: `apps/admin/src/server/chapters.ts`, `src/components/chapter-form.tsx`, the PPI tab in
  `src/components/organizations-page.tsx`, rows in `chapters-model.ts`
- Web: `apps/web/src/server/chapters.ts`, `src/app/map/…`, About `src/app/about/page.tsx`, map
  image `apps/web/public/map/asia-oceania.svg` (from PPIDK)
- Periods: `Period`, `PeriodInputSchema`, `withPeriodDates`, `canChangePeriod`,
  `canActivatePeriod` in the same domain file; Firestore `packages/db/src/firestore/periods.ts`
  (`periods/{id}`, `settings/activePeriod`); admin `apps/admin/src/server/periods.ts`, the Period
  tab in `organizations-page.tsx`, rows in `periods-model.ts`
- Structure: `OrgUnit`, `OrgUnitInputSchema`, `placeOrgUnit`, `assertNoCycle`, `movedPath`,
  `orgUnitPath`, `inTreeOrder` in the same domain file; Firestore
  `packages/db/src/firestore/org-units.ts` (`orgUnits/{id}`, code index
  `orgUnitCodes/{periodId}_{code}`); admin `apps/admin/src/server/org-units.ts`,
  `src/app/(panel)/organizations/periods/[id]/page.tsx`, `src/components/org-structure-page.tsx`,
  rows in `org-units-model.ts`
- Tests: `tests/unit/chapters.test.ts`, `tests/integration/chapters.test.ts`,
  `tests/integration/periods.test.ts`, `tests/integration/org-units.test.ts`

## Rules and assumptions

- Every stored field is public. The contact person is entered with the contact details the
  chapter agreed to publish only; nothing private is kept on a chapter.
- Country: 2-letter ISO code (upper-cased); time zone: IANA name; links http(s); at most 5 other
  links; latitude/longitude in degrees (the marker, e.g. the country's centre).
- `mapPosition(lat, lng)` turns the coordinates into percent of the map box. The map is
  equirectangular; the constants are fitted to the PPIDK map (Astana, Tokyo, Wellington).
- One reader list (`listActive`) drives the markers, the About list and the count, so they never
  disagree; inactive chapters are hidden everywhere on the site.
- Permission `organizations.edit` (global) to add, edit, activate and deactivate;
  `organizations.read` to see the page. A chapter admin (`organizations.edit` for one chapter)
  edits only that chapter's contact person, public contact, website, e-mail, Instagram and links;
  name, country, time zone, logo, URL and map position stay with the national board (refused on
  the server, disabled in the form). Audit module `organizations`, resource `chapter`; revertible for 14 days except
  edits that changed the URL. There is no delete route.
- The gateway JSON (`/v1/chapters`, the "KSK API" in the flowchart) is not built until the owner
  confirms who uses it.
- The events list will get its country filter from these chapters once events carry a chapter.
- Periods: draft → active → archived. Exactly one period is active: activation is one
  transaction that reads `settings/activePeriod`, archives that period, activates the draft and
  points `settings/activePeriod` to it (concurrent activations are serialized by it). Only a
  draft can be activated; archived periods are read-only; periods are never deleted (no route).
- Role assignments with a `periodId` count only while that period is active
  (`packages/permissions/docs/authorization.md`), so activating a period switches the board's
  period-bound roles at once.
- Permission `periods.edit` to add, edit and activate (admin page `periods`, shown as the Period
  tab of Organizations); `periods.read` to see the tab. Audit module `periods`, resource
  `period`; not revertible (a revert could bring back a second active period).
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
- The code is upper-cased and unique per period. Units are deactivated, never deleted (there is
  no delete route). Members of a unit come from appointments (step 3.7).
- Appointments (B7): on the Structure page of the active period, `appointments.edit` appoints a
  person (by account e-mail) to a unit as head, secretary or member with a title, and ends an
  appointment (kept as history). The roles an appointment gives are described in
  `packages/permissions/docs/authorization.md`. Tests: `tests/integration/appointments.test.ts`.
- Permission `structure.edit` to add, edit and move (admin page `structure`);
  `structure.read` to see the tree. Audit module `structure`, resource `orgUnit`; not revertible
  (a revert would not rewrite the paths below the unit).

## Configuration

Logo uploads need `FIREBASE_STORAGE_BUCKET`. Firestore index `chapters (active, name)`.
