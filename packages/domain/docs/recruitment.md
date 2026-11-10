# Recruitment (Oprec)

## What it does

The recruitment committee opens a recruitment for a board period: a window, the units that take
officers (seat quota per unit, portfolio rule per unit), how many ordered unit choices an
applicant makes, how long an offer stays valid, and the recruitment form whose questions
applicants answer. Members apply on the website with a complete member profile: they pick their
choices, upload a portfolio (PDF) when a chosen unit asks for one, answer the questions, save a
draft and submit. Each person has ONE application per recruitment, and the application page
shows ONE next action.

## Where it lives

- Rules: `packages/domain/src/recruitment/index.ts` (statuses and transitions, set-up schema,
  window, choices, portfolio rule, `nextAction`, offer expiry).
- Storage: `packages/db/src/sql/recruitment.ts` — admin store (`recruitments`,
  `seatCounters`) and web store (the applicant's own `applications/{recruitmentId}_{uid}`).
- Admin: `apps/admin/src/server/recruitment.ts` (set-up) and `applications.ts` (selection), pages
  `/recruitment` (`src/components/recruitment-page.tsx`, `recruitment-model.ts`) and
  `/recruitment/{id}/applications` (`applications-page.tsx`, `applications-model.ts`),
  `/recruitment/{id}/interviews` (`interviews-page.tsx`; actions `src/server/interviews.ts`).
- Web: `/recruitment`, `/recruitment/[id]` (status + next action), `/recruitment/[id]/apply`,
  upload route `POST /api/recruitment/[id]/portfolio[?question=q_…]`; logic
  `apps/web/src/server/recruitment.ts`, wiring `recruitment-wiring.ts`.
- Tests: `tests/unit/recruitment.test.ts`, `tests/unit/admin-recruitment.test.ts`,
  `tests/integration/recruitment.test.ts`, `tests/integration/selection.test.ts`,
  `tests/integration/interviews.test.ts`, `tests/integration/ratification.test.ts`,
  `tests/unit/personality.test.ts`, `tests/integration/personality.test.ts`.

## How to use it

```ts
import { nextAction } from "@website/domain/recruitment";

const action = nextAction(recruitment, ownApplication, new Date()); // "start" | "revise" | …
```

## Rules and assumptions

- **Statuses** (feature-spec C3): draft → submitted → (revision → submitted) | admin_rejected |
  interview → offered → accepted | declined → approved → pakta_review (→ approved) → confirmed;
  other ends rejected, withdrawn. `TRANSITIONS` is the only source; final statuses lead nowhere.
- **Set-up** (`recruitment.edit`): the period must exist and not be archived; units must be of
  that period; the form must be a recruitment form, and applicants answer its CURRENT version
  when the recruitment is saved (frozen once someone submits). Each unit has a counter
  `seatCounters/{recruitmentId}_{orgUnitId}` `{ quota, filled }`, written in the same
  transaction; a quota never goes below `filled`, and a unit with taken seats cannot be removed.
- **Applying** (`applications.read_own` / `applications.write_own`): always the session's uid;
  signed in and `isProfileComplete` required. Drafts check answers without requiring them; submit
  needs the window open, 1..maxChoices distinct units of the recruitment, every required answer
  and a portfolio when a chosen unit is flagged. Withdrawing is possible until a seat is taken.
- **Files**: portfolios and file-question answers are PDFs only (`%PDF-` magic bytes), at most
  5 MB, stored privately (no URL): `recruitment/{id}/{uid}/portfolio_…pdf` and
  `forms/{formId}/{uid}_…pdf`. File answers come only from the upload route; a file "answer" sent
  with a draft is ignored, so no path can point at another applicant's file.
- **Selection** (admin `/recruitment/{id}/applications`, tabs per step; `src/server/applications.ts`):
  `recruitment.review` requests a revision (a new round `applicationRevisions/{appId}_{n}` with
  the request; rounds are never overwritten, a resubmission sets `resubmittedAt`; only while the
  application window is open, because the applicant can only resubmit then; a revision left
  open when the window closes can still be failed), fails
  (`admin_rejected`), passes (`interview`) and rejects; `recruitment.offer` offers one unit of the
  recruitment, valid `offerDays` (a full unit cannot be offered). Each decision is one
  transaction with its audit entry. The queue page needs review, offer or confirm.
- **Seats**: taken only when the applicant ACCEPTS on the website: the accept transaction reads
  and writes `seatCounters/{recruitmentId}_{unitId}` and refuses when `filled >= quota`, so
  concurrent accepts never exceed the quota. Rejecting an accepted applicant gives the seat back
  in the same transaction. Declining takes nothing.
- **Interviews** (C3-I, admin `/recruitment/{id}/interviews`, `src/server/interviews.ts`,
  `recruitment.review`): a day plan (day, from/until, minutes per interview, minutes between,
  a break, people per time, link or room) on the committee's clock becomes `interviewSlots`
  in UTC (`slotTimes`, at most 100 per plan, past times skipped). The day view lists each time
  with who booked it. An applicant in `interview` books on the website, shown on the clock of
  their profile time zone: ONE transaction reads the application, the chosen slot
  (`booked < capacity`, future, same recruitment) and the old slot, so capacity holds under
  concurrency and a re-booking frees the old time. A time with bookings is never deleted.
- **Placement, pact, ratification** (C3 steps 7-9): `recruitment.confirm` (give it only to the
  Sekjen's role) approves the placement (accepted → approved). The applicant downloads the pact
  template (the recruitment's "Integrity pact template" link — [OWNER] provides the file) and
  uploads the signed PDF (private) → `pakta_review`; `recruitment.review` may send it back with a
  note (→ approved); every uploaded pact is kept (`pacts`). Ratify (`recruitment.confirm`,
  recent sign-in) sets `confirmed` AND creates the appointment (member seat in the offered unit
  of the ACTIVE period) in ONE transaction through the step 3.7 functions
  (`prepareAppointment`/`writeAppointment`), so roles are derived the normal way; the ratifier
  must hold the roles' permissions (`canRatifyInto`), staff roles need the applicant's second
  sign-in method, nobody ratifies themselves, and the applicant's sessions are renewed.
  `confirmed` is final: the appointment is created once.
- **Personality test** (C5, `src/recruitment/personality.ts`, ported from PPIDK
  `TesKepribadian`): 60 IPIP-adapted statements (Indonesian and English), 5 axes, a 16-type
  label plus an A/T suffix; not a clinical tool, not affiliated with any brand. After submitting,
  the application page shows a signed 7-day link `/test/personality/{token}` (LINK_SIGNING_SECRET,
  purpose "personality"; no sign-in needed). The server scores the answers (-3..3, all 60
  required) and stores ONE result in `personalityResults/{uid}` (scores only, never
  overwritten). The committee sees it on the application.
- **Offers** expire at read time (`offerExpired`): no job releases them; an expired offer cannot
  be answered and the committee may offer again.
- **Files** are opened by the committee through 15-minute signed links, only for paths that
  belong to that application (`fileUrl`, `recruitment.review`).
- **Audit**: set-up changes (module `recruitment`, resource `recruitment`; CREATE and DELETE
  revertible). Applicant changes are logged with the member as actor (resource `application`):
  status, choices, round, offer and portfolio name — never the answers.

## Import from PPIDK (block J, step 5.8)

- Mapping: `packages/db/src/ppidk/recruitment.ts` (pure, tested in
  `tests/unit/ppidk-recruitment-import.test.ts`); script:
  `infrastructure/scripts/import-ppidk-recruitment.mjs --dir <tsv folder> [--files <PPIDK private
storage>] [--apply]` (dry run by default, writes `import-recruitment-report.json`). Run it after
  the people import (it refuses otherwise); accounts are matched the same way (e-mail, else
  `ppidk-<id>`). Ids come from PPIDK (`ppidk-form-<id>`, `ppidk-recruitment-<id>`, ...), so a
  second run writes the same documents.
- Forms keep their versions and responses; guest forms get two extra questions (name and e-mail
  of the respondent). PPIDK `url` fields become short answers.
- Only the latest application per person and recruitment is imported, with its ranked choices,
  revision rounds, interview and pact; seat counters are rebuilt from the applications that hold
  a seat. Personality results keep the scores only.
- Files: only real PDFs (checked by their first bytes) found under `--files` are referenced and
  copied privately to `FILE_STORAGE_DIR`; other files are listed in the report as skipped.

## Configuration

`FILE_STORAGE_DIR` on web (portfolio uploads); `LINK_SIGNING_SECRET` on web (the
personality test links; the same secret signs newsletter links, the purpose keeps them apart).
