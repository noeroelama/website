# Organisation: chapters (PPI Negara) and the map

## What it does

Staff keep the list of member councils (PPI Negara) on the admin **Organizations → PPI** tab:
name, country, time zone, logo, public contact person, website, e-mail, Instagram and other
links, and the marker position on the map. A chapter is deactivated, never deleted. The website
shows the active chapters on `/map` (Asia–Oceania dot map, one marker per chapter; a click shows
its card) and lists the same chapters with their count on About.

The Period and Structure tabs of the Organizations page are still design mocks (steps 3.2, 3.3).

## Where it lives

- Rules and form schema: `packages/domain/src/organizations/index.ts` (`Chapter`,
  `ChapterInputSchema`, `mapPosition`, `toPublicChapter`)
- Firestore: `packages/db/src/firestore/chapters.ts` (`chapters/{id}`, slug index
  `chapterSlugs/{slug}`, built on `slugged.ts`; `createFirestoreChapterReader` for the web)
- Admin: `apps/admin/src/server/chapters.ts`, `src/components/chapter-form.tsx`, the PPI tab in
  `src/components/organizations-page.tsx`, rows in `chapters-model.ts`
- Web: `apps/web/src/server/chapters.ts`, `src/app/map/…`, About `src/app/about/page.tsx`, map
  image `apps/web/public/map/asia-oceania.svg` (from PPIDK)
- Tests: `tests/unit/chapters.test.ts`, `tests/integration/chapters.test.ts`

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

## Configuration

Logo uploads need `FIREBASE_STORAGE_BUCKET`. Firestore index `chapters (active, name)`.
