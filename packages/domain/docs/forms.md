# Forms (versioned questions)

## What it does

Staff build forms on the admin **Forms** page: a title, a description, where the form is used
(a **public form** answered by guests, or a **recruitment form** answered inside an application)
and a list of questions. Questions live in numbered versions. A version is **frozen** once
anyone answered it: changing the questions then saves version n+1, and earlier answers keep
pointing at the version they answered. Answers are always validated on the server by a strict
Zod schema built from the version.

## Where it lives

- Rules: `packages/domain/src/forms/index.ts` (question types, `FormInputSchema`,
  `planVersion`, `assertPublishable`, `formWindow`, `answersSchema`/`parseAnswers`,
  `responseTable`).
- Storage: `packages/db/src/firestore/forms.ts` — `forms/{id}` and
  `formVersions/{formId}_{n}`.
- Admin: `apps/admin/src/server/forms.ts` (guarded actions), page `/forms`
  (`src/components/forms-page.tsx`, `forms-model.ts`).
- Tests: `tests/unit/forms.test.ts`, `tests/unit/admin-forms.test.ts`,
  `tests/integration/forms.test.ts`.

## How to use it

```ts
import { parseAnswers } from "@website/domain/forms";

const result = parseAnswers(version.questions, rawAnswers);
if (!result.ok) return result.fields; // question id → message ("form" = unknown key)
store(result.answers); // keyed by question id
```

## Rules and assumptions

- **Question types:** short answer (≤ 300 characters), paragraph (≤ 5,000), e-mail, number
  (optional min/max), date (`YYYY-MM-DD`, never shifted by a time zone), single choice,
  checkboxes (optional "most ticks"), file, consent (must be ticked when required). Choices have
  2–50 unique options and may allow one free-text "Other" answer. At most 100 questions.
- **Question ids** (`q_` + 8 characters) are created by the server and never change, so the
  answers of every version share a column in the responses table.
- **Freezing:** unchanged questions write nothing; an unanswered version is edited in place; an
  answered version is never changed (`planVersion`). The response that first answers a version
  marks it `answered` in the same transaction.
- **Answers:** text goes through `safeText` (no HTML); unknown keys are refused (`.strict()`);
  blank answers to optional questions are dropped; required questions must be answered.
- **Usage** (public / recruitment) changes only while the form is a draft. Recruitment forms
  are never published at a public link.
- **Files** are for signed-in applicants only: a public form cannot have a file question
  (`assertPublishable`), so guests never upload anything. A file answer is a private Storage
  path under `forms/{formId}/…`.
- **Permissions:** page `forms` — `forms.read` (list), `forms.edit` (build, delete).
- **Audit:** module `forms`, resource `form`. A CREATE (revert = trash) and a DELETE (revert =
  restore) can be reverted; edits cannot (they may have created a version). Question versions
  are never deleted.

## Configuration

None.
