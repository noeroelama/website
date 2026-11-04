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

## Suggested roles (data, Role Manager)

Roles are data (DEC-11): create these in Role Manager → Edit Role (nothing is seeded in code).

| Role (suggested id)          | Permissions                                    |
| ---------------------------- | ---------------------------------------------- |
| `officer` (every officer)    | `okr.read`                                     |
| `director` (unit head, unit) | `okr.edit` (scoped to the unit by appointment) |
| `secretary_general`          | `okr.edit` (global: region objectives, vision) |
