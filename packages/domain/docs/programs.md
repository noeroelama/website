# Programmes (OKR, work programmes, LPJ, report card)

Phase 6 of the plan (features E1-E5), ported from PPIDK `app/Support/Proker` and DECISIONS
§23-27 (rules and edge cases, not the PHP structure). This doc grows with each step.

```text
period vision + mission → objectives → key results → programmes → milestones
                                                          ↓
                                                   weekly check-in → LPJ
```

## OKR (E1)

Code: `src/programs/okr.ts` (rules), `packages/db/src/sql/programs.ts`
(`createSqlObjectiveStore`), `apps/admin/src/server/okr.ts` (guarded actions), admin page
`/okr` (`okr.read` / `okr.edit`). Tests: `tests/unit/programs.test.ts`,
`tests/integration/okr.test.ts`.

- **Vision and mission** live on the period (`periods/{id}.vision`, `.mission`): they change
  with the board and there are never two at once. They are edited on the OKR page (global
  `okr.edit`); the period form keeps them as they are.
- **Objectives** (`objectives/{id}`): `periodId`, `orgUnitId` (a unit of that period, or `null`
  for an objective of the whole region), `orgUnitPath` (scope), title, description, sort, and
  their **key results** inside the document (at most 20): title, unit ("people", "%"),
  baseline, target, current value, direction (`up` / `down`: some results are reached by
  shrinking, e.g. days to process a letter), sort, `measuredAt` (moves only when the value
  changes). A key result is a number, always; a goal that is not a number belongs in the
  objective's description. Objectives are deleted softly.
- **Achievement** (computed, never stored): a key result is where the current value sits between
  baseline and target, the same formula for both directions, clamped to 0-100 (a negative or
  180% value would distort averages); target = baseline means "keep it" (100 unless it moved the
  wrong way). An objective is the plain average of its key results (no weights: none were ever
  agreed), 0 without any.
- **Period scoping**: the page shows one period (`?period=`, default the active one). Every write
  reads the period in its transaction and refuses a missing or **archived** period (history is
  read-only); the unit must be a live unit of the same period.
- **Scope**: an `orgUnit` assignment of `okr.edit` covers that unit's objectives and the units
  below it; region objectives and the vision/mission need a global assignment. Moving an
  objective to another unit also needs `okr.edit` there.
- Audit: module `okr`, resource `objective` (key result changes are updates of their objective)
  or `period` (vision/mission); not revertible.

## Work programmes (E2) and weekly check-ins (E3)

Code: `src/programs/programs.ts` (rules), `packages/db/src/sql/programs.ts`
(`createSqlProgramStore`), `apps/admin/src/server/programs.ts` (guarded actions,
`canManageProgram`), admin pages `/programs` (list per period) and `/programs/[id]`. Tests:
`tests/unit/programs-workflow.test.ts`, `tests/integration/programs.test.ts`.

```text
proposed ──→ approved ──→ running ──→ finished
   ↑            │
   └────────────┘  returned with a note (the approval is withdrawn)
cancelled ← from proposed, approved or running, with a reason
```

- **Plan** (`programs/{id}`, `programs.edit` of the unit, scope `orgUnit`): name, goal,
  background, the proposing unit (of the period), the key result it serves (an objective of the
  same period, or none yet), planned dates, **budget lines** (`Money`: integer minor units +
  ISO 4217, one line per currency, never converted — DECISIONS §27) and the **PICs** (named by
  account e-mail, stored as uids). The plan can be edited until the programme is finished or
  cancelled; a new programme cannot be added to an archived period.
- **Approve** (`programs.approve`) needs at least one PIC; **return** (with a note) withdraws
  the approval; **cancel** needs a reason. **Start** needs at least one milestone; **finish**
  does not need every milestone done (what was not done is what the LPJ explains).
- **Running it** (start, finish, milestones, health, check-ins): `canManageProgram` — a PIC
  listed on the programme, or someone with `programs.edit` of its unit. Being a PIC is not a
  role (DECISIONS §24): a PIC only needs `programs.read` to open the page.
- **Milestones** live in the programme (at most 50): title, due date, **weight** (1-100), sort,
  completed at / by. `progressPercent` = weight done ÷ total weight, rounded, recomputed in the
  same write as every milestone change (add, edit weight, remove, done, opened again); there is
  no input field. No milestones = 0%.
- **Health** (`on_track` / `at_risk` / `off_track`, approved or running only) always needs a
  reason — also "on track" — and records who and when.
- **Weekly check-in**: `programCheckins/{programId}_{weekStartUtc}` (Monday 00:00 UTC: one
  week line for the whole region, UTC+5:30 to UTC+13). What was done (required), blockers,
  next week. Sending again in the same week updates that week's check-in; approved or running
  programmes only.
- Audit: module `programs`, resources `program` and `checkin`; not revertible.

## LPJ (E4) and its PDF (D9)

Code: `src/programs/lpj.ts` (rules), `packages/db/src/sql/programs.ts`
(`createSqlProgramStore().finish`, `createSqlLpjStore`), `apps/admin/src/server/lpj.ts`
(guarded actions, `lpjSheet`, `createLpjFileRoute`), `packages/pdf/src/report.ts`
(`renderReportPdf`), admin pages `/lpj` (`lpj.read`, list per period) and `/lpj/[id]`
(`lpj.read`, or `programs.read` of the programme's unit), PDF `GET /api/lpj/<id>/pdf`. Tests:
`tests/unit/lpj.test.ts`, `tests/integration/lpj.test.ts`.

```text
draft ──→ submitted ──┬─ secretariat review ─┐
  ↑                   └─ treasurer review  ──┴─→ approval ─→ approved
  └── returned (note; every desk cleared) ←─ any desk
```

- **Opened by finishing the programme**, in the same transaction: `lpjReports/{programId}`
  (one LPJ per programme; a second `create` fails the transaction) with a **frozen plan**
  (name, goal, background, unit name, dates, budgets, PICs, progress, milestones with their
  final state, started/finished) and `dueOn` = the finish day (UTC) + `period.lpjDeadlineDays`
  (14 when the period has none). The plan is a copy: nothing later changes it.
- **PICs write and submit** (`canManageProgram`): realization, participants, money spent per
  currency (`realized`, `null` = not filled in, `[]` = nothing spent), obstacles,
  recommendations. Completeness is checked at submit, not at save.
- **Three desks** (named extras of the `lpj` page): `lpj.review_secretariat` (the Secretariat
  bureau, global — not a directorate secretary, who writes LPJs), `lpj.review_treasurer` and
  `lpj.approve`. The two reviews come in any order; the approval needs both. **Three different
  people**, and **the submitter never signs** any desk. The treasurer refuses an LPJ without
  money spent.
- **Return** (any desk holder, with a note) clears all three desks and counts the revision
  round; the PICs edit and submit again.
- **Overdue** is a read-time rule (`isOverdue`: not approved and today (UTC) > `dueOn`). The due
  date is extended with `programs.approve` (a deadline the PIC can move is no deadline), never
  after approval.
- **PDF** rendered at download time from the record (`lpjSheet` → `renderReportPdf`, never
  stored): the frozen plan, the PICs' report, budgets per currency, and the desks with name and
  date — a desk that has not signed prints "Belum diperiksa / not yet reviewed".
- **Notices** (J2, `notices.lpj`, `apps/admin/docs/messaging.md`): opened → PICs (with the due
  date); submitted → both review desks; both reviews in → the approval desk; returned /
  approved → PICs.
- **Dashboard**: a warning when no account holds `lpj.review_secretariat` globally (shown to
  `roles.edit`, LPJ desks and programme approvers).
- Audit: module `lpj`, resource `lpj`; not revertible. LPJs are never deleted.

## Period report card (E5)

Code: `src/programs/report.ts` (pure maths), `packages/db/src/sql/programs.ts`
(`createSqlPeriodReport().card(periodId, now)`), admin page `/programs/report?period=`
(`programs.read`; linked from the Programmes header). Tests: `tests/unit/report-card.test.ts`,
`tests/integration/lpj.test.ts` (report card).

- **Computed on every request, nothing stored** (a stored report goes stale and is then read as
  the truth).
- Programme numbers are COUNT queries: per status, "at risk" (approved or running with health
  at risk / off track), and **completion** = finished ÷ (approved + running + finished) —
  proposals and cancelled programmes were never promises and are left out.
- LPJ numbers are COUNT queries: waiting for review (submitted), approved, **overdue** (not
  approved and `dueOn` before today, UTC — the same read-time rule as `isOverdue`).
- **OKR achievement** = average of the objectives' achievement (each the plain average of its
  key results).
- **Budget absorption per currency, never converted**: planned = budget lines of approved,
  running and finished programmes; spent = money spent of **approved** LPJs only (checked by
  the treasurer); absorption = spent ÷ planned (none when nothing was planned in that
  currency). Totals use `addMoney`, which refuses to add two currencies.
- Shortcut: the budget totals read the documents (the store has COUNT, not SUM); fine for a few
  hundred programmes per period.
- The card shows the whole period's totals to anyone with `programs.read` (programmes are open
  to every officer, DECISIONS §24).

## Suggested roles (data, Role Manager)

Roles are data (DEC-11): create these in Role Manager → Edit Role (nothing is seeded in code).

| Role (suggested id)          | Permissions                                                        |
| ---------------------------- | ------------------------------------------------------------------ |
| `officer` (every officer)    | `okr.read`, `programs.read` (enough to be a PIC)                   |
| `director` (unit head, unit) | `okr.edit`, `programs.edit` (scoped to the unit by appointment)    |
| `secretary_general`          | `okr.edit`, `programs.approve` (global: region objectives, vision) |
| `coordinator`                | `programs.approve`                                                 |
| `secretariat` (bureau)       | `lpj.review_secretariat` (global), `programs.read`                 |
| `treasurer`                  | `lpj.review_treasurer`, `programs.read`                            |

`secretary_general` and `coordinator` also get `lpj.approve`. No suggested role holds two LPJ
desks (separation of duties; the rule in code holds anyway, also for a superadmin).
