# Zoom

Zoom bookings (F1), ported from PPIDK `app/Support/Zoom/*` (rules only). Webhooks, the waiting
room and transcripts (F2) and the recording archive (F3) build on the same records.

## What it does

A staff member books a Zoom room for their unit; capacity is the organisation's licences ×
concurrent meetings per licence. With approval switched on, an approver decides; then the Zoom
meeting is created on the licensed host, its link is shortened (silent mode, K1) and an
invitation text with a QR code is ready to forward. A booking made for a platform meeting
(F4) can be chosen there as the room (Zoom XOR an external link).

```
request ─(approval off, capacity free)─→ approved ─(room created)─→ join link
   └─(approval on)─→ pending ─[approve]─→ approved      pending/approved ─[cancel]─→ cancelled
                          └─[reject]─→ rejected
```

## Where it lives

- Rules: `packages/domain/src/zoom/index.ts`; store `packages/db/src/sql/zoom.ts`
- Actions: `apps/admin/src/server/zoom.ts`; API client `apps/admin/src/server/zoom-client.ts`
- Page `/zoom` (`zoom-page.tsx`); cron `zoom-rooms`; tests `tests/integration/zoom.test.ts`

## Rules

- **Times**: start as wall time + IANA zone → UTC. Refused: a start in the past; less than
  `minNoticeHours` ahead (the message says the latest time in the chosen zone); longer than
  `maxDurationMinutes` unless `zoom.long_duration`. Passcode 1-10 of `A-Z a-z 0-9 @ * _ -`;
  join before host 0 / 5 / 10 / 15 minutes.
- **Unit**: from the requester's active appointment (`activeForUser`); none = region. The
  requester needs `zoom.edit` there.
- **Capacity** (one transaction): entering "approved" reads `zoomCapacity/{yyyy-mm-dd}` for
  every UTC day the booking touches (end exclusive), refuses when the approved bookings
  overlapping it already reach licences × concurrent, then adds the slot to each day; leaving
  "approved" (cancel) removes it. Concurrent requests cannot both take the last slot (row locks).
- **Approval** (`settings/zoom.approvalRequired`): pending holds no capacity; approve checks it.
- **Room**: created after the commit (`createMeeting`: type 2, start in UTC, zone, password,
  join before host). A failure keeps the slot and records `roomError` (the same failure is not
  written again); cron `zoom-rooms` (every 10 minutes, 10 bookings per call) retries.
- **Cancel** (requester or `zoom.approve` for the unit): frees the slot, then deletes the Zoom
  meeting (a 404 counts as deleted; other failures are logged).
- **Invitation**: topic, time in the booking's zone, short link, meeting id, passcode. Never the
  Host Key.
- **Settings** (`settings/zoom`, `zoom.settings`): licences, concurrent per licence, approval,
  minimum notice, longest booking, Host Key (6 digits, stored with `encryptField` and
  FIELD_ENCRYPTION_KEY; the audit log shows only "(set)").
- **Client**: Server-to-Server OAuth token cached per process until a minute before it expires;
  15 s timeout; Zoom errors read from JSON (`message`) or XML (`<message>`).

## Webhooks (F2)

`POST /webhooks/zoom` (`apps/admin/src/server/zoom-webhook.ts`, listed in
`ADMIN_WEBHOOK_PATHS`): body ≤ 256 KB → signature `x-zm-signature` = `v0=` + HMAC-SHA256 of
`v0:{x-zm-request-timestamp}:{body}` with `ZOOM_WEBHOOK_SECRET_TOKEN`, 5-minute tolerance →
`endpoint.url_validation` answered with `{ plainToken, encryptedToken }` → de-duplication
(`webhookEvents`, key from event, meeting uuid and `event_ts`) → only OUR meetings (a booking
with that `zoomMeetingId`; never matched by host e-mail) → the work. Failures are logged; Zoom
always gets a short answer.

- `zoomEventMeeting` reads the meeting from both payload shapes (`object.id/uuid` for meetings
  and recordings, `object.meeting_id/meeting_uuid` for AI summaries).
- `meeting.ended` after the booked end: one Zoom update turns the waiting room on and
  join-before-host off, and the booking gets `closedAt` (once). An earlier "ended" (host left)
  is ignored.
- `recording.completed`: the session uuid is added to `recordingUuids` (the archive, F3, uses
  them) and the requester is told; `meeting.summary_completed`: the requester is told. Keys
  `zoom:{bookingId}:recording|summary:{uuid}`.
- **Pull Zoom transcript** (minutes, F6): for a meeting whose room is a Zoom booking,
  `GET /meetings/{zoomMeetingId}/recordings` → the `TRANSCRIPT` file downloaded with the API
  token → the machine draft (`source = ai_zoom`). No recording yet (404 or no file) = a message.

[OWNER] Zoom app → Feature → Event Subscriptions: endpoint `https://<admin domain>/webhooks/zoom`
(production only), events `meeting.ended`, `recording.completed`,
`meeting.summary_completed`; copy the Secret Token into `ZOOM_WEBHOOK_SECRET_TOKEN`.

## Recording archive (F3)

- Sessions: `recording.completed` adds `recordingSessions/{hex(uuid)}` (bookingId, listedAt,
  trashedAt). cron `recording-archive` lists up to 3 new sessions per call
  (`GET /meetings/{uuid}/recordings`, a UUID starting with "/" or containing "//" encoded twice)
  into `recordingFiles/{zoomFileId}`. While Zoom still processes a file (often the transcript),
  the session stays unlisted and is listed again on later calls, for up to 24 hours after the
  recording; auto-delete waits until the session is fully listed. A 404 lists it empty. Then moves
  **one 8 MB chunk of one file** (an upload in progress first): Zoom download with a byte
  `Range` → Drive resumable upload (`Content-Range`); progress (`uploaded`, session URL) is
  stored, the next call continues.
- Drive layout: `[YYYY-MM-DD] Topic/Topic - type.ext` (date in the booking's zone, names
  cleaned of `\ / : * ? " < > |`), under `GOOGLE_DRIVE_FOLDER_ID`, as the impersonated
  Workspace user (service account with domain-wide delegation; JWT signed with node:crypto).
- Same name already in the folder: same size = done; a different size = **clash** (status
  `clash`, logged, shown on the Zoom page, never overwritten, never skipped silently).
- Failures count `attempts`; after 5 the file is `failed` (shown). A file Zoom no longer lists
  fails at once.
- "Archived" is computed at read time (`isArchived`): every listed session has files and all are
  done; a new session or a clash clears it.
- **Auto-delete** (`settings/zoom.autoDeleteRecordings`, default OFF): once every file of a
  session is done, that session goes to the Zoom trash (`?action=trash`), once.
- Block G: the job is built for shared hosting (one chunk per call, ~8 MB, 25 s Drive timeout).
  [OWNER] measure one call on DomaiNesia; if a chunk cannot finish inside the request limit,
  this one job moves to a small VPS (same code, same cron URL).

## Permissions

`zoom.read`, `zoom.edit` (book), `zoom.approve`, `zoom.long_duration`, `zoom.settings`.
