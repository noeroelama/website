# Documents (letters, verification, certificates)

Phase 4 of the plan (features D1-D9), ported from PPIDK `app/Support/Letters`. This doc grows
with each step.

## Letter numbers

- `formatNumber(pattern, values)` in `src/documents/numbering.ts` builds a number from the letter
  type's pattern. The placeholders keep PPIDK's names, so imported letter types number exactly as
  before: `{nomor}` (padded sequence; `007.037` for sheet 37 of a certificate batch), `{jenis}`
  (type code, trimmed), `{unit}` (issuing unit code, `PPIDK` when none), `{bulan_romawi}`
  (`VIII`), `{bulan}` (`08`), `{tahun}` (`2026`), `{tahun_pendek}` (`26`), `{kode_kegiatan}`
  (batch activity code, upper case). Month and year come from the letter date.
- `checkNumberPattern(pattern)` refuses an unknown placeholder and a pattern without `{nomor}`
  (PPIDK printed unknown placeholders as they were; a printed number can never be corrected).
- Counters: `nextNumbers(db, tx, { collection, id }, count)` (`packages/db/src/firestore/counters.ts`)
  reserves `count` numbers from `{ last }` inside the caller's transaction, before its first
  write. Numbers are reserved only when a letter is issued (no gaps from abandoned drafts) and
  never given back (a cancelled letter keeps its number).

## Private files

- `isPdf(bytes)` (`@website/domain/shared`) checks the `%PDF-` magic bytes of every private PDF
  upload (portfolios, pacts, letter archives, scans).
- `sha256Hex(bytes)` (`@website/security`) is stored with an archived file and compared when
  the file is served.

## Letters workflow (D1, D2)

`src/documents/letters.ts` (pure rules, from PPIDK `SuratService`), `packages/db/src/firestore/letters.ts`
(store), `apps/admin/src/server/letters.ts` (guarded actions), admin pages `/letters` and
`/letters/types`.

```text
draft ─→ review ─→ corrected ─→ desks ─→ approved ─→ issued ─→ cancelled
  ↑________________________________|  "Return to draft" with a note (clears both desks)
```

- **Write** (`letters.edit`): type, issuing unit (of the active period; its code is `{unit}`),
  subject, recipient (only for types that have one: a type without recipient clears it on save),
  letter date, place, attachment note, body (rich text, sanitized with the news allowlist;
  images are not printed). Drafts and letters in review can be edited; drafts can be deleted
  (softly). Everything required is checked on **Submit**, not at the desk.
- **Scope**: an org-unit assignment of `letters.edit` (directors, directorate secretaries) covers
  the letters of that unit and the units below it (`orgUnitPath`, `scopedOrgUnitIds`); the list
  shows only those letters. A global assignment covers all.
- **Desks** (Letters page extras, roles are data): `review` (secretariat: pass the correction
  or return it), `sign` (Secretary-General desk), `sign_coordinator` (second desk, only for
  types that require it), `issue`, `cancel`. Nobody signs before the correction is passed;
  one person never holds both desks of a letter.
- **Issue** (`letters.issue`), ONE transaction: the next number from
  `letterCounters/{periodId}_{typeId}` (formatted with the type's pattern), a verification code
  (`8F3KM-QRTVW`, alphabet without I L O 0 1, `verificationCodes/{code}` — the space shared with
  certificates), the signers frozen with their desk, name and seat at that time (`signers`), and
  `contentDigest` = sha256 of `letterCanonical` (number, date, type, subject, recipient, body,
  signers' ids; line endings unified). A failure uses no number and writes no audit entry.
- **Cancel** (`letters.cancel`): issued letters only, with a reason (shown on the public
  verification page later); the number is never reused.
- **Audit**: module `letters` (CREATE / UPDATE per step / DELETE / PUBLISH = issue / UNPUBLISH =
  cancel), never revertible (a step is undone by returning or cancelling). The snapshot stores
  the body's length, not the body.
- **Letter types** (`letter_types.edit`, `/letters/types`): name, code (unique case-insensitively,
  trimmed), number pattern (checked, with a live example), digits of `{nomor}`, Coordinator desk,
  recipient, whether the verification page shows the content to anyone, in use, order.
  Deactivated, never deleted. Suggested roles: Secretary General (all desks but the
  Coordinator's, letter types), Coordinator (`sign_coordinator`, `cancel`), Director and
  Directorate secretary (`letters.edit`, scoped to their unit by the appointment).
- Not built yet: the PDF and archive (4.3), the public verification page (4.4), the upload path
  (`awaiting_file`, 4.7), PPIDK's format checker (warnings) and notifications to the desks.

## QR codes (D8)

One set of rules (`src/documents/qr.ts`, from PPIDK `PembuatQr`) for the Tools page and the
letter and certificate PDFs: content of at most `QR_MAX_LENGTH` (800) characters
(`qrTextProblem`), error correction `H`, a 4-module quiet zone, downloads at 300 / 600 / 1000
px. The optional centre logo goes only on PNGs, on an opaque plate in the code's light colour
covering 22% of the width (`qrLogoPlate`, under 5% of the area); SVGs never carry it. PDFs embed
the QR without a logo (the letterhead already shows the emblem).

## Tests

`tests/unit/documents.test.ts`, `tests/integration/numbering.test.ts`,
`tests/security/field-encryption.test.ts`, `tests/unit/admin-tools.test.ts` (QR rules),
`tests/unit/letters.test.ts`, `tests/unit/admin-letters.test.ts`, `tests/integration/letters.test.ts`.
