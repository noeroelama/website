# Organisation: chapters (PPI Negara), the map and board periods

## What it does

Staff keep the list of member councils (PPI Negara) on the admin **Organizations → PPI** tab:
name, country, time zone, logo, public contact person, website, e-mail, Instagram and other
links, and the marker position on the map. A chapter is deactivated, never deleted. The website
shows the active chapters on `/map` (Asia–Oceania dot map, one marker per chapter; a click shows
its card) and lists the same chapters with their count on About.

Board periods (kepengurusan, feature A1) are kept on the **Organizations → Period** tab: name
(2026/2027), cabinet, start and end date, vision, mission and the LPJ deadline (days after the
end). A new period is a draft; **Set as Active** makes it the active period and archives the one
that was active. The Structure screen is still a design mock (step 3.3).

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
- Tests: `tests/unit/chapters.test.ts`, `tests/integration/chapters.test.ts`,
  `tests/integration/periods.test.ts`

## Rules and assumptions

- Every stored field is public. The contact person is entered with the contact details the
  chapter agreed to publish only; nothing private is kept on a chapter.
- Country: 2-letter ISO code (upper-cased); time zone: IANA name; links http(s); at most 5 other
  links; latitude/longitude in degrees (the marker, e.g. the country's centre).
- `mapPosition(lat, lng)` turns the coordinates into percent of the map box. The map is
  equirectangular; the constants are fitted to the PPIDK map (Astana, Tokyo, Wellington).
- One reader list (`listActive`) drives the markers, the About list and the count, so they never
  disagree; inactive chapters are hidden everywhere on the site.
- Permission `organizations.edit` to add, edit, activate and deactivate; `organizations.read` to
  see the page. Audit module `organizations`, resource `chapter`; revertible for 14 days except
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

## Configuration

Logo uploads need `FIREBASE_STORAGE_BUCKET`. Firestore index `chapters (active, name)`.
