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

## Suggested roles (data, Role Manager)

Roles are data (DEC-11): create these in Role Manager → Edit Role (nothing is seeded in code).

| Role (suggested id)          | Permissions                                                        |
| ---------------------------- | ------------------------------------------------------------------ |
| `officer` (every officer)    | `okr.read`, `programs.read` (enough to be a PIC)                   |
| `director` (unit head, unit) | `okr.edit`, `programs.edit` (scoped to the unit by appointment)    |
| `secretary_general`          | `okr.edit`, `programs.approve` (global: region objectives, vision) |
| `coordinator`                | `programs.approve`                                                 |
