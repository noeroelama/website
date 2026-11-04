# Finance

Finance requests (I1), the cash book (I2) and the cash report (I3), ported from PPIDK
`app/Support/Keuangan/{KeuanganService,BukuKasService}.php` (rules only). Money is the shared
`Money` type (DEC-8).

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

## Cash book (I2)

`cashEntries/{id}`: lines of money that really moved, per board period, each in its own
currency (minor units). Two ways in, nothing else writes the book:

- **Mark paid** writes `cashEntries/{requestId}` in the SAME transaction as the request's
  `paid` status (`createSqlFinanceStore().pay`): a paid request without its line, or a line
  twice, would make the report lie. A line that already exists refuses the payment. Category
  map: receipt → in/receipt, disbursement → out/disbursement, reimbursement →
  out/reimbursement; **budget requests write nothing** (a plan, not a money movement). The line
  carries the amount actually paid, the payment day (UTC) and the proof.
- **Manual lines** (`finance.cashbook`, global): opening balance, member dues, donations,
  receipts, bank interest, other income; activity, operational, reimbursement, disbursement,
  other spending. The category must belong to the kind (in/out); amount > 0; an optional unit of
  the period.

Lines are never edited or deleted here (a mistake is corrected by a new line); every line has an
audit entry (`resourceType: cashEntry`, not revertible).

## Cash report (I3)

`cashReport(entries, { from, to })` recomputes everything from the period's lines on every
request (the page and `GET /api/finance/report?from=&to=&format=csv|pdf`; the query chooses
the range only): one section **per currency, never added together**; `opening` = all lines
before `from` (so the range continues from the real balance), totals in and out, per-category
totals, rows by date then creation with the running balance, `closing`. Both ends inclusive,
either may be open; `from` after `to` is refused.

- **CSV** (standard library only): `currency,date,kind,category,description,in,out,balance,source`,
  an `opening` and a `closing` row per currency, amounts as plain decimals ("1500000.00"),
  UTF-8 with BOM, text cells quoted and prefixed with `'` when they start like a formula.
- **PDF**: `renderTablePdf` (`@website/pdf`), one table per currency with its totals.
- Both need `finance.export` held **globally** (the book is the organisation's), and each export
  is logged as a `data.export` security event (dataset `cash_report`, format, range).
- The page `/finance/cashbook` (global `finance.cashbook` or `finance.export`) shows the same
  report and the manual-entry form.

## Permissions (page `finance`)

`finance.read`, `finance.edit` (make requests for one's unit), extras `finance.review`
(treasurer), `finance.authorize` (coordinator), `finance.pay` (mark paid with proof),
`finance.cashbook` (manual cash book lines) and `finance.export` (cash report CSV/PDF).
Unit-scoped assignments see and act on their unit's requests (and units below); global ones on
all; the cash book and its report need a global assignment.

Suggested roles for the Role Manager (roles are data, DEC-11; there is no seed script, create
them there): **Treasurer** = `finance.review` + `finance.pay` + `finance.cashbook` +
`finance.export`; **Coordinator** = `finance.authorize` + `finance.export`; **Director /
requester** = `finance.edit` scoped to their unit.

## Where it lives

| Part    | File                                                                                                 |
| ------- | ---------------------------------------------------------------------------------------------------- |
| Rules   | `packages/domain/src/finance/{requests,cashbook}.ts`, `packages/domain/src/shared/money.ts`          |
| Store   | `packages/db/src/sql/finance.ts` (`financeRequests`, `cashEntries`)                                  |
| Actions | `apps/admin/src/server/finance.ts`, wired in `wiring.ts` (`financeActions`)                          |
| PDF     | `packages/pdf/src/table.ts` (`renderTablePdf`)                                                       |
| Page    | `/finance`, `/finance/cashbook` (`finance-page.tsx`, `cashbook-page.tsx`, `finance-model.ts`)        |
| Routes  | `/api/finance/[id]/files` (documents, proof), `/api/finance/report` (CSV, PDF)                       |
| Tests   | `tests/unit/{finance,cashbook,admin-finance,table-pdf}.test.ts`, `tests/integration/finance.test.ts` |

## Assumptions

- `programId` is stored as a reference only: programmes (step 6.2) were built in parallel; it is
  validated against `programs` when the two are merged.
- The cash book is per board period (as PPIDK); a new period starts with a manual opening
  balance line.
- Documents and proof are PDFs only (the private-file block); a phone screenshot must be saved as
  PDF first.
