# Tasks and calendar

My Tasks and unit task boards (G1), ported from PPIDK `Tugas/*`.

## What it does

**My Tasks** (`/tasks`, every staff member): the meeting follow-ups where I am PIC, the
incoming-letter dispositions addressed to me or to a unit I hold an appointment in, and the
milestones of the approved or running programmes I am PIC of. **Unit boards**
(`/tasks/unit/[id]`): everything of a unit and the units below it in the active period.

## Rules

- A READ MODEL (`packages/domain/src/tasks`): there is no tasks collection; a task is
  `{ kind, title, source, due, done, overdue, href, orgUnitPath }` built from the source records.
  Completing happens in the source module (meeting page, Incoming letters, programme page).
- Overdue is computed at read time: not done and the due date is before today (UTC).
- Order: open first, then by due date (none last), then title.
- A board opens with `tasks.read` for the unit, or when it is shared with the viewer
  (`taskBoardShares/{orgUnitId}_{uid}`, set by `tasks.share` holders by account e-mail,
  audited). A share is VIEW ONLY and grants no permission: a task's link is shown only when the
  viewer may read the source page in the task's scope (`visibleTask`).

## Where it lives

`packages/domain/src/tasks/index.ts`, `apps/admin/src/server/tasks.ts`,
`packages/db/src/sql/task-shares.ts`, pages `apps/admin/src/app/(panel)/tasks/**`,
tests `tests/integration/tasks.test.ts`.

## Permissions

`tasks.read` (unit boards), `tasks.share` (share a unit's board). My Tasks needs none.

## Calendar (G2)

- `/calendar` (`calendar.read`): a month grid and list (UTC days) over the viewer's meetings
  (participant or `meetings.read`), Zoom bookings (requester or `zoom.read`; pending ones marked),
  milestones of approved/running programmes and LPJ due dates (PIC or the module's read
  permission, active period) and holidays (`holidays`, managed with `calendar.holidays`).
- Warnings: a holiday is judged on the item's own clock (the meeting's or booking's zone); a
  meeting without a Zoom room at a time when every licence is booked gets "No Zoom licence is
  free".
- **Feed** `GET /calendar/<uid>.<signature>.ics` (outside `/api`, no session; the sign-in
  redirect skips it): signature = HMAC-SHA256(`CALENDAR_FEED_SIGNING_SECRET`,
  `calendar:{uid}:{version}`); "Revoke" bumps `calendarFeeds/{uid}.version`, so every older link
  answers 404, as do unknown, inactive or no-longer-staff accounts. The feed uses the SAME read
  model and filters as the screen, 30 days back to a year ahead.
- ICS: CRLF lines, 75-octet folding that never splits a UTF-8 character, `\ ; , newline`
  escaped, all-day items `VALUE=DATE` with an exclusive `DTEND`.
- Not built: free calendar entries (`calendarEvents`); the calendar shows module records only.
