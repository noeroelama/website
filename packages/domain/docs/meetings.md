# Meetings

Meetings (F4), ported from PPIDK `app/Support/Rapat/*` (rules only). Minutes (F5) and
machine-drafted minutes (F6) build on the same document.

## What it does

Staff schedule a meeting of a unit (or of the whole region) with participants who each have a
role IN the meeting; the chair and the secretary run it (room, attendance, cancel, minutes). The
room is a Zoom booking XOR an external link. Participants sign the attendance with a short code
shown on the meeting screen (or its QR); reminders go out before the start and after the end.

```
scheduled ──(end time passes, read-time)──→ finished
    └──(chair/secretary cancels with a reason)──→ cancelled
```

## Where it lives

- Rules: `packages/domain/src/meetings/index.ts`
- Store: `packages/db/src/sql/meetings.ts` (`meetings`, `attendanceCodes`)
- Admin: `apps/admin/src/server/meetings.ts`, pages `/meetings`, `/meetings/[id]`,
  cron job `meeting-reminders` (`apps/admin/docs/cron.md`)
- Web: `/attend` and `/attend/[code]` (`apps/web/src/server/attendance.ts`)
- Tests: `tests/integration/meetings.test.ts`

## Fields

| Field                        | Rule                                                                  |
| ---------------------------- | --------------------------------------------------------------------- |
| `title`                      | 2-200 characters                                                      |
| `orgUnitId`                  | a unit (scope via `orgUnitPath`) or null = whole region (global edit) |
| `startsAtLocal` + `timeZone` | wall time in an IANA zone → `startsAt` in UTC; never in the past      |
| `durationMinutes`            | 5-720 → `endsAt`                                                      |
| `agenda[]`                   | ≤ 30 items; ids kept for unchanged titles (minutes are per item)      |
| `participants[]`             | account e-mails → uids; exactly one chair, at most one secretary      |
| `room`                       | `{ zoomRequestId, externalUrl }`: saving one clears the other         |
| `attendance`                 | uid → `{ at, method: code \| manual }`; the first sign-in counts      |

## Rules

- **Authority from the role in the meeting**: chair and secretary run it (`canRunMeeting`), as
  does whoever holds `meetings.edit` for its unit. Their actions need `meetings.read` in some
  scope (`inSomeScope` in `createGuardedAction`), the handler checks the seat.
- Scheduling and editing need `meetings.edit` for the unit (global for region meetings). A
  finished or cancelled meeting no longer changes.
- **Attendance codes**: 6 characters from an alphabet without look-alikes, valid 2 minutes, the
  screen asks for a new one every 90 seconds. Only `sha256("attend:" + code)` is stored
  (`attendanceCodes/{hash}` with `expiresAt`; the `expire` cron job deletes old ones). A code is
  accepted from 30 minutes before the start to 30 minutes after the end, only from a signed-in
  participant; typing ignores case, spaces and dashes. Wrong, expired and other people's codes
  get the same kind of answer.
- The chair or secretary may tick someone present (paper list) once the meeting has started, or
  remove a wrong tick.
- **Reminders** (cron `meeting-reminders`): start reminder in the 15 minutes before the start,
  end reminder in the hour after the end, to every participant on their channel (WhatsApp when
  a number exists, else e-mail), keys `meeting:{id}:start:{uid}` and `meeting:{id}:end:{uid}`,
  so a job interval up to 15 minutes works and a repeated call sends nothing twice.

## Minutes and action items (F5)

- `meeting.minutes`: notes per agenda item (`notes[agendaItemId]`), other business, `quorum`
  (people needed; null = not set), `source` (`manual`, `ai_transcript`, `ai_zoom`).
- The chair and the secretary write them (`saveMinutes`); notes of items no longer on the agenda
  and empty notes are dropped.
- **Approve and lock**: the chair, or `meetings.approve_minutes` for the meeting's unit, once the
  meeting has started. Approval sets `approvedAt/By` and freezes `attendanceSnapshot` (uids
  present); after that the minutes and the attendance no longer change (audited, not revertible).
- Quorum met = present (the snapshot once approved) ≥ quorum; shown on the PDF.
- **Action items** (`actionItems/{id}`: meetingId, meetingTitle, periodId, orgUnitPath, title,
  pic, dueOn, doneAt): added and edited by whoever runs the meeting; the PIC must be a
  participant (checked in the transaction on every save); the PIC or the chair marks them done;
  they stay editable after approval. Overdue = due date before today and not done (read-time;
  My Tasks reads them by PIC).
- **PDF** at `/api/meetings/[id]/minutes`, rendered on request (`minutesSheet`), never stored:
  attendance (frozen list once approved), quorum, notes per item, action items, approval line.

## Machine-drafted minutes (F6)

- Port `MinutesDrafter` (`drafting.ts`); adapter `apps/admin/src/server/anthropic.ts`
  (Anthropic Messages API, `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL`, default
  `claude-sonnet-4-5`; forced tool output validated with `DraftOutputSchema`; 60 s timeout). No
  key = the "Draft from transcript" button is hidden and the action refuses.
- Input: a pasted transcript or a Zoom `.vtt` file (step 7.7 adds the Zoom pull). `parseVtt`
  drops the header, NOTE blocks, cue numbers and timings, keeps every spoken line, treats a
  "Name: " prefix as a speaker only when it occurs at least twice, joins a speaker's lines in a
  row.
- The draft fills only EMPTY agenda items (`mergeDraft`; a person's notes are never
  overwritten); `minutes.source` records `ai_transcript` / `ai_zoom` when the machine wrote first.
- Proposed action items come back to the page; a PIC who is not a participant becomes "no PIC"
  and a person adds each item, which re-checks the PIC on save.
- A failure is logged (`minutes draft failed`) and nothing is written.

## Permissions

`meetings.read`, `meetings.edit`, `meetings.approve_minutes` (F5) — Role Manager → Meetings.
