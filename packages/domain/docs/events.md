# Events (admin Event page)

## What it does

Staff create events on the admin **Event** page: title, type, date and time with the event's
time zone, registration deadline, location, description, banner, optional external registration
link, URL, schedule (rundown), guest speakers and sponsors. **Save draft** keeps it hidden,
**Publish** shows it on the site; the row menu publishes/unpublishes at once, copies the public
link (`/events/<slug>`) or moves the event to the trash.

## Where it lives

- Rules and form schema: `packages/domain/src/events/index.ts` (`EventEntity`, `EVENT_TYPES`,
  `EventInputSchema`, `randomEventSlug`, `sortedSponsors`, `isRegistrationOpen`)
- Time zone helpers: `packages/domain/src/shared/time.ts` (`wallTimeToUtc`, `utcToWallTime`)
- Firestore: `packages/db/src/firestore/events.ts` (`events/{id}`, slug index `eventSlugs/{slug}`,
  built on `slugged.ts`)
- Admin actions: `apps/admin/src/server/events.ts`; page `apps/admin/src/app/(panel)/events/`
  (`src/components/events-page.tsx`, rows mapped in `events-model.ts`)
- Tests: `tests/unit/events-cms.test.ts`, `tests/unit/time.test.ts`,
  `tests/unit/admin-events.test.ts`, `tests/integration/events-cms.test.ts`

## Rules and assumptions

- Required: title (3–200), type (fixed list; labels in `apps/admin/src/labels.ts`), date and time,
  time zone (IANA, e.g. `Asia/Tokyo`, defaults to the editor's browser), location, description,
  banner (preset `banner`). The date, time and deadline are entered on the event's own clock and
  stored in UTC.
- The registration deadline must be on or before the event date. Empty = registration closes when
  the event starts.
- The URL slug is unique; when left empty the server picks `event-` + 8 random hex characters.
- Registration link: http(s) only; empty = the site's own registration (step 2.5).
- Sponsors keep the order of the list (`order` 1, 2, 3 …); the site shows them in that order.
  Speaker photos and sponsor logos use the `speaker` upload preset.
- Permission `events.edit` for every change (there is no separate publish permission);
  `events.read` to see the page.
- Every change is one transaction with a version check and an audit entry (module `events`,
  resource `event`): CREATE / UPDATE / PUBLISH / UNPUBLISH / DELETE. Delete is a soft delete;
  registrations (`eventRegistrations`) are kept. Revertible for 14 days except edits that changed
  the URL.
- The admin list loads the 500 most recently changed events and filters them in the browser.

## Public pages and registration

`toPublicEvent` is what the website shows (no version or capacity). The web reader
(`createFirestoreEventReader`) lists published, live events; `createFirestoreRegistrationStore`
registers a member in one transaction: event open (`isRegistrationOpen`, closes exactly at the
deadline) → no existing `eventRegistrations/{eventId}_{uid}` → status by
`nextRegistrationStatus` and the counter `eventCounters/{eventId}`. Pages and captcha:
`apps/web/docs/public-site.md`.

## Configuration

Uploads need `FIREBASE_STORAGE_BUCKET`.
