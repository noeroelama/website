# Finance

Finance requests (I1), ported from PPIDK `app/Support/Keuangan/KeuanganService.php` (rules
only). Money is the shared `Money` type (DEC-8).

## What it does

A unit asks for money (or for approval of a budget plan); the treasurer checks the numbers, the
coordinator authorises, the treasurer transfers manually and records it with the proof of
transfer; the requester then marks it done. There is no payment gateway.

```
draft ─→ submitted ─[treasurer review]─→ reviewed ─[coordinator authorisation]─→ authorized
  ↑                                                                                │ mark paid
  └── revision ←── returned by the desk whose turn it is (clears BOTH desks)       ↓ (proof)
                                                                           paid ─→ done
           rejected by the desk whose turn it is → rejected (final)
```

## Money (DEC-8)

`@website/domain/shared` → `money.ts`: `Money { amountMinor, currency }` (integer minor units,
ISO 4217), `money`, `addMoney` (refuses mixing currencies), `minorDigits`, `formatMoney`
("IDR 1,500,000.00") and `toMinor` (typed amount → minor units, null when invalid).
`@website/domain/shop` re-exports `money`/`addMoney`/`Money`, so the shop API and tests did not
change and shop still imports nothing but the shared kernel. Minor digits are a fixed table
(JPY, KRW, VND = 0, others 2), not Intl: CLDR gives IDR 0 cash digits, ISO and PPIDK store 2, and
a stored amount must mean the same on every runtime. Amounts of different currencies are never
added or converted (PPIDK DECISIONS §27).

## Fields

| Field                     | Rule                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `category`                | `receipt`, `disbursement`, `reimbursement`, `budget` (a plan, no money moves)      |
| `orgUnitId`               | a unit of the active period; gives `orgUnitPath` (scope)                           |
| `title`                   | activity or purpose, ≤ 200                                                         |
| `amountMinor`, `currency` | integer ≥ 0; one of `FINANCE_CURRENCIES` (IDR and the region's currencies)         |
| `date`                    | plain date or null                                                                 |
| `account`                 | destination account "Bank - number - name", ≤ 150                                  |
| `fundSource`              | ≤ 100                                                                              |
| `programId`               | optional work-programme budget line; a plain id, NOT checked yet (see Assumptions) |
| `documents[]`             | private PDFs (proposal, RAB, receipts), ≤ 10 MB each, at most 10                   |

Required before submit (`REQUIRED_FIELDS`, PPIDK `WAJIB`; checked at submit, drafts may be
incomplete):

| Category      | Title | Amount > 0 | Date | Account | Fund source | Documents |
| ------------- | ----- | ---------- | ---- | ------- | ----------- | --------- |
| receipt       | ✓     | ✓          | ✓    | ✓       | ✓           | ✓         |
| disbursement  | ✓     | ✓          | ✓    | ✓       | ✓           |           |
| reimbursement | ✓     | ✓          |      | ✓       |             | ✓         |
| budget        | ✓     | ✓          | ✓    |         |             | ✓         |

## Rules

- **Separation of duties.** The requester (`createdBy`) never acts at a desk on their own request
  (review, authorise, return, reject, mark paid), whatever their roles. The coordinator's
  authorisation must come from a different person than the treasurer's review.
- **Whose turn.** `submitted` is at the treasurer's desk (`finance.review`), `reviewed` at the
  coordinator's (`finance.authorize`); only that desk may return or reject. A return needs a
  note, clears both desk stamps and counts `revisionRound`; a rejection needs a reason and is
  final (make a new request).
- **Mark paid** (`finance.pay`): only `authorized`; the amount actually transferred (> 0, same
  currency, may differ from the amount asked) and the proof PDF in one upload. The status and
  the requester are checked before the file is stored.
- **Edits** (fields, documents, delete) only in `draft` and `revision`, by `finance.edit` in the
  request's unit. Delete is soft (`deletedAt`).
- **Files** are private (`finance/{periodId}/{id}_{doc|proof}_{uuid8}.pdf`), served by
  `GET /api/finance/{id}/files?path=` to `finance.read` in scope, only when their sha256 still
  matches.
- **Audit**: every change is one transaction with its audit entry (module `finance`, not
  revertible: a desk step is undone by a return or a new request).
- **Notices** (J2, `apps/admin/docs/messaging.md`): submitted → `finance.review` holders,
  reviewed → `finance.authorize`, authorized → `finance.pay`; revision, rejected and paid → the
  requester. Key `finance:{id}:{status}:{version}:{uid}`.

## Permissions (page `finance`)

`finance.read`, `finance.edit` (make requests for one's unit), extras `finance.review`
(treasurer), `finance.authorize` (coordinator), `finance.pay` (mark paid with proof). Unit-scoped
assignments see and act on their unit's requests (and units below); global ones on all.

Suggested roles for the Role Manager (roles are data, DEC-11; there is no seed script, create
them there): **Treasurer** = `finance.review` + `finance.pay`; **Coordinator** =
`finance.authorize`; **Director / requester** = `finance.edit` scoped to their unit.

## Where it lives

| Part    | File                                                                                                  |
| ------- | ----------------------------------------------------------------------------------------------------- |
| Rules   | `packages/domain/src/finance/index.ts`, `packages/domain/src/shared/money.ts`                         |
| Store   | `packages/db/src/sql/finance.ts` (`financeRequests`)                                                  |
| Actions | `apps/admin/src/server/finance.ts`, wired in `wiring.ts` (`financeActions`)                           |
| Page    | `/finance` (`finance-page.tsx`, `finance-model.ts`), `/api/finance/[id]/files`                        |
| Tests   | `tests/unit/finance.test.ts`, `tests/unit/admin-finance.test.ts`, `tests/integration/finance.test.ts` |

## Assumptions

- `programId` is stored as a reference only: programmes (step 6.2) were built in parallel; it is
  validated against `programs` when the two are merged.
- Documents and proof are PDFs only (the private-file block); a phone screenshot must be saved as
  PDF first.
