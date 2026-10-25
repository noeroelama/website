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
- Not built yet: the upload path (`awaiting_file`, 4.7),
  PPIDK's format checker (warnings) and notifications to the desks.

## Letter PDF, letterhead, archive (D1, D9)

- **Rendering**: `@website/pdf` (`renderLetterPdf`, pdf-lib + qrcode, pure JavaScript) lays out
  PPIDK's template: letterhead, "Tokyo, 2 November 2026", Nomor / Lampiran / Perihal / Jenis,
  "Kepada Yth.", the body (Times 12 pt, 1.5 lines, justified, first-line indent 1.27 cm, lists,
  headings), the desks (electronic-signature box with the date, or "waiting"), the note that no
  wet signature is needed, the cancelled stamp, and the QR with the verification address and
  code. Images and tables in the body are not printed. Dates are written in Indonesian in WIB.
- **Letterhead** (`settings/letters`, Letter types page → Letterhead, `letter_types.edit`):
  parent name, name, address line, full-width letterhead / footer / watermark images, emblem,
  watermark strength (2-40 %), "Paraf" box. Images are uploaded with the `letterhead` preset
  (public WebP, converted to PNG with sharp when rendering) and must come from that folder.
  Without a letterhead image the text letterhead (emblem + names) is printed. It is FROZEN on
  the letter at issue (`letters.letterhead`): a new design never changes issued letters; a lost
  image falls back to the text letterhead.
- **QR address**: `https://<VERIFICATION_HOST>/<CODE>` (PPIDK's printed form, e.g.
  `verif.ppiasiania.id/8F3KM-QRTVW`) or `<WEB_URL>/verify/<CODE>` (`verificationUrl`).
- **Archive**: right after the issue transaction the PDF is rendered and stored privately at
  `letters/<periodId>/<letterId>_<random>.pdf` with its sha256 and size (`letters.archive`,
  recorded once: a second render never replaces it). If that fails the letter stays issued and
  the first PDF request archives it.
- **Preview / download**: `GET /api/letters/<id>/pdf` (admin, `letters.read` in the letter's
  unit; otherwise 404). Issued letters: the archive, its sha256 checked (a mismatch is an error,
  never a silent re-render); drafts: rendered now without number or QR; cancelled letters:
  rendered now with the stamp. The Letters detail view has the button.
- Code: `apps/admin/src/server/letter-pdf.ts`, route `apps/admin/src/app/api/letters/[id]/pdf/route.ts`.
- Configuration: `VERIFICATION_HOST` (or `WEB_URL`) and `FIREBASE_STORAGE_BUCKET` on admin.

## Public verification (D7)

Anyone holding a letter checks it without signing in (PPIDK `VerifikasiController`):

- **Addresses**: `<WEB_URL>/verify` (type the code), `<WEB_URL>/verify/<CODE>` and, on
  `VERIFICATION_HOST` (the extra domain of the web app, e.g. `verif.ppiasiania.id`), the printed
  short form `/<CODE>` (and `/<CODE>/pdf`); any other path there shows the search page
  (`apps/web/src/lib/verification-host.ts`, rewrite in `apps/web/src/proxy.ts`). Never indexed.
  At most 20 requests per minute per IP on these paths.
- **What it shows** (`letterVerification`, public DTO only — no ids): valid or cancelled (date,
  reason), number, type, subject, the recipient masked (`A*** N***`, always three stars), letter
  date, issuing unit, period, and the signers frozen at issue (desk, name, seat, time in WIB).
  Drafts have no code; unknown, malformed and draft codes all answer "not found".
- **Content**: shown when the type's "content public" is on; otherwise after typing the
  recipient's name exactly as printed (case and spaces ignored), sent by a server action, never
  in the URL. If the stored text no longer matches `contentDigest` the content is shown to
  nobody. Letters without a digest (imported) are shown.
- **Download**: the archived PDF, under the same rule (checked again in the route), never for
  cancelled letters (the archive has no stamp), never when its sha256 does not match (the page
  then says so).
- Code: `packages/domain/src/documents/verification.ts`, reader
  `createFirestoreVerificationReader`, `apps/web/src/server/verification.ts`, pages
  `apps/web/src/app/verify/**`. Not built: PPIDK's camera scanner (the phone's camera app opens
  the QR link directly).

## Incoming letters and dispositions (D6)

`src/documents/incoming.ts` (rules, from PPIDK `AgendaService`), `packages/db/src/firestore/incoming.ts`,
`apps/admin/src/server/incoming.ts`, admin page `/incoming` (Admin page "Incoming letters":
read, edit, extra `dispose`).

- **Record** (`incoming.edit`): sender, sender's number, subject, letter date, received date,
  summary. The agenda number (`042/AG/VIII/2026`: sequence of the active period, Roman month and
  year of the received date) is given in the recording transaction (`incomingCounters/{periodId}`):
  the letter is in hand, so no number is ever left unused. Fields stay editable until archived;
  the agenda number never changes.
- **Scan**: one private PDF (≤ 10 MB, `%PDF-` checked), `POST /api/incoming/<id>/scan?version=`,
  stored at `letters/incoming/<periodId>/<id>_<random>.pdf` with its sha256; opened inline with
  `GET /api/incoming/<id>/scan` (`incoming.read`), never when the checksum no longer matches.
- **Dispose** (`incoming.dispose`): to a unit of the letter's period OR an officer (active
  appointments), with an instruction and an optional due date. Forwarding a disposition creates a
  child and marks the parent "in progress" (it stays responsible). A disposition is marked done
  (optional response) only when every disposition forwarded from it is done; when all are done the
  letter is "done" and can be archived (`incoming.edit`), after which nothing changes.
- Every step is one versioned write with an audit entry (module `incoming`, not revertible).
- Not built yet: notifications to the recipients (7.1) and image scans (PPIDK also took JPG/PNG;
  scan to PDF).

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
`tests/unit/letters.test.ts`, `tests/unit/admin-letters.test.ts`, `tests/integration/letters.test.ts`,
`tests/unit/pdf.test.ts`, `tests/integration/letter-pdf.test.ts`, `tests/unit/verification.test.ts`,
`tests/integration/verification.test.ts`, `tests/unit/incoming.test.ts`,
`tests/unit/admin-incoming.test.ts`, `tests/integration/incoming.test.ts`.
