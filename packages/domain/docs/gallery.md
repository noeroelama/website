# Gallery albums

## What it does

Staff attach a photo album to a published event on the admin **Gallery** page: 1 to 10 featured
images, an optional total photo count and the link to the full external album (e.g. Google
Photos). Visitors see one card per published album on `/gallery`; the album page shows the
featured images in a lightbox and a **See all photos** button that opens the external album in a
new tab. An event page whose registration has closed links its album.

## Where it lives

- Rules and form schema: `packages/domain/src/gallery/index.ts` (`Album`, `AlbumInputSchema`,
  `ALBUM_MAX_IMAGES`, `canHaveAlbum`, `toPublicAlbum`)
- Firestore: `packages/db/src/firestore/gallery.ts` (`galleries/{id}`, slug index
  `gallerySlugs/{slug}`, built on `slugged.ts`)
- Admin: `apps/admin/src/server/gallery.ts`, page `apps/admin/src/app/(panel)/gallery/`
  (`src/components/gallery-page.tsx`, rows in `gallery-model.ts`)
- Web: `apps/web/src/server/gallery.ts`, pages `apps/web/src/app/gallery/…` (lightbox: native
  `<dialog>`, `lightbox.tsx`)
- Tests: `tests/unit/gallery.test.ts`, `tests/integration/gallery-cms.test.ts`

## Rules and assumptions

- An album needs a published, live event and 1 to 10 images (upload preset `gallery`); the total
  count is optional (whole number ≥ 0; empty = the number of featured images); the album link must
  be http(s).
- The URL slug is unique; empty = the event's URL. The public page is `/gallery/<slug>` (a slug
  instead of the id keeps links readable).
- Permission `gallery.edit` for every change, `gallery.read` to see the page.
- Every change is one transaction with a version check and an audit entry (module `gallery`,
  resource `album`). Delete is a soft delete; images stay in Storage until a later cleanup.
  Revertible for 14 days except edits that changed the URL.
- The site shows published albums only, cached for minutes (`cacheTag("gallery")`).

## Configuration

Uploads need `FIREBASE_STORAGE_BUCKET`. Firestore indexes `galleries (published, updatedAt desc)`
and `galleries (eventId, published)`.
