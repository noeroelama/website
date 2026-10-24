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
- Storage: `packages/db/src/firestore/recruitment.ts` — admin store (`recruitments`,
  `seatCounters`) and web store (the applicant's own `applications/{recruitmentId}_{uid}`).
- Admin: `apps/admin/src/server/recruitment.ts`, page `/recruitment`
  (`src/components/recruitment-page.tsx`, `recruitment-model.ts`).
- Web: `/recruitment`, `/recruitment/[id]` (status + next action), `/recruitment/[id]/apply`,
  upload route `POST /api/recruitment/[id]/portfolio[?question=q_…]`; logic
  `apps/web/src/server/recruitment.ts`, wiring `recruitment-wiring.ts`.
- Tests: `tests/unit/recruitment.test.ts`, `tests/unit/admin-recruitment.test.ts`,
  `tests/integration/recruitment.test.ts`.

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
- **Offers** expire at read time (`offerExpired`): no job releases them.
- **Audit**: set-up changes (module `recruitment`, resource `recruitment`; CREATE and DELETE
  revertible). Applicant changes are logged with the member as actor (resource `application`):
  status, choices, round, offer and portfolio name — never the answers.

## Configuration

`FIREBASE_STORAGE_BUCKET` on web (portfolio uploads).
