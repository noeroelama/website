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

## QR codes (D8)

One set of rules (`src/documents/qr.ts`, from PPIDK `PembuatQr`) for the Tools page and the
letter and certificate PDFs: content of at most `QR_MAX_LENGTH` (800) characters
(`qrTextProblem`), error correction `H`, a 4-module quiet zone, downloads at 300 / 600 / 1000
px. The optional centre logo goes only on PNGs, on an opaque plate in the code's light colour
covering 22% of the width (`qrLogoPlate`, under 5% of the area); SVGs never carry it. PDFs embed
the QR without a logo (the letterhead already shows the emblem).

## Tests

`tests/unit/documents.test.ts`, `tests/integration/numbering.test.ts`,
`tests/security/field-encryption.test.ts`, `tests/unit/admin-tools.test.ts` (QR rules).
