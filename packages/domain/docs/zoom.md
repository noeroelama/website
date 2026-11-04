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

## Permissions

`zoom.read`, `zoom.edit` (book), `zoom.approve`, `zoom.long_duration`, `zoom.settings`.
