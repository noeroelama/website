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
- Counters: `nextNumbers(db, tx, { collection, id }, count)` (`packages/db/src/sql/counters.ts`)
  reserves `count` numbers from `{ last }` inside the caller's transaction, before its first
  write. Numbers are reserved only when a letter is issued (no gaps from abandoned drafts) and
  never given back (a cancelled letter keeps its number).

## Private files

- `isPdf(bytes)` (`@website/domain/shared`) checks the `%PDF-` magic bytes of every private PDF
  upload (portfolios, pacts, letter archives, scans).
- `sha256Hex(bytes)` (`@website/security`) is stored with an archived file and compared when
  the file is served.

## Letters workflow (D1, D2)

`src/documents/letters.ts` (pure rules, from PPIDK `SuratService`), `packages/db/src/sql/letters.ts`
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
  Deactivated, never deleted. Give the permissions in the Role Manager, as in PPIDK: the
  Secretary-General's role every desk but the Coordinator's plus letter types and incoming
  letters; the Coordinator's role `sign_coordinator` and `cancel`; directors and directorate
  secretaries `letters.edit` (scoped to their unit by the appointment).
- Not built yet: PPIDK's format checker (warnings) and notifications to the desks.

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
- Configuration: `VERIFICATION_HOST` (or `WEB_URL`) and `FILE_STORAGE_DIR` on admin.

## Upload path (D3)

For documents typed elsewhere (SOP, decrees with annexes, tables), from PPIDK `UnggahDokumen`:

```text
draft (Document: own PDF) ─→ review ─→ corrected ─→ desks ─→ approved
  ─→ "Take number" ─→ awaiting_file ─→ upload PDF, place stamps, preview ─→ issued
```

- **Write**: choose "Own PDF" when creating (fixed afterwards); no body. The same correction and
  desks as typed letters.
- **Take number** (`letters.issue`, the issue button of an upload letter): the same transaction
  as issue (number, verification code, signers, digest) but the letter becomes `awaiting_file`
  with no issue date. It may be cancelled from there (the number is never reused).
- **Upload** (`letters.edit` in the letter's unit): `POST /api/letters/<id>/file?version=` with
  the PDF (≤ 10 MB, `%PDF-` checked, opened with pdf-lib: locked or damaged files are refused
  with a clear message). The number check: a PDF with a text layer (≥ 40 characters) must
  contain the number (spaces and case ignored); a PDF without one (a scan) is accepted as "not
  checked", recorded on the letter (`upload.numberChecked`) and in the audit entry. Stored at
  `letters/<periodId>/<id>_upload_<random>.pdf` with its sha256; a new upload replaces (and
  removes) the previous one.
- **Placement** (`letters.edit`): page and mm from the top-left corner for the QR (with its size;
  the code and address are printed under it) and for each desk's signature (at the signer's own
  width and rotation, only once that desk signed). Nothing placed = the file is kept as is.
- **Preview** (`GET /api/letters/<id>/pdf`) and **Issue the stamped PDF** (`letters.issue`) use
  the SAME function (`stampUpload` in `apps/admin/src/server/letter-pdf.ts`): the stamped bytes
  are stored as the archive (sha256, size), the letter becomes `issued` with its issue date. A
  stored upload whose checksum no longer matches is refused; a file replaced between stamping
  and the issue write is refused (issue again).
- Code: `src/documents/letters.ts` (`checkUploadedNumber`, `attachUpload`, `placeStamps`,
  `issueUpload`), `apps/admin/src/server/letters.ts` (`upload`, `place`, `issueFile`),
  `packages/pdf/src/stamp.ts`, `apps/admin/src/components/letter-upload-panel.tsx`,
  route `apps/admin/src/app/api/letters/[id]/file/route.ts`.

## Certificates (D5)

Many sheets from one template, from PPIDK `SertifikatService` (the opposite of the upload path):

- **Batch** = a letter created as "Certificate batch" (`source: "certificate"`), with an
  activity code (`{kode_kegiatan}`, required when the type's pattern uses it; stored upper
  case) and an optional citation (the body as plain lines; empty = "atas partisipasinya dalam
  kegiatan <subject>"). The same correction and desks; the batch needs at least one participant
  before it is issued, and gets ONE agenda number (the type's counter).
- **Participants** (`/letters/<id>/participants`, `letters.edit` in the batch's unit, only while
  the batch is a draft or under review): pasted from a spreadsheet, one per line, a note after
  the first TAB, `;` or `|` (never a comma: names carry degrees), spaces tidied, duplicates KEPT
  (two people may share a name), at most 1000 lines per paste, optional title case (degrees and
  particles kept). A column that is an e-mail address (anywhere after the name) is the pickup
  e-mail: stored only as `emailHash` = keyedHash("certificate-email", lower-cased address,
  SUBSCRIBER_HASH_SECRET), never as the address. Each sheet gets its sequence
  (`certificateCounters/{batchId}`) and its own verification code when added, CERTIFICATE_CHUNK
  (200) per transaction. Removing one deletes its sheet and code; the others keep their numbers
  (audit: module `letters`).
- **Numbers**: at issue the batch freezes `sheetNumberTemplate` (`001.{sheet:3}/SERT/LKMM/...`);
  sheet 37 is `001.037/SERT/LKMM/...`. A later pattern change never renumbers printed sheets.
- **Sheets** are rendered on demand (`GET /api/letters/<id>/certificates/<sheetId>`,
  `letters.read` in scope; `renderCertificatePdf`): A4 landscape, double frame, emblem and names
  from the letterhead frozen at issue (no letterhead band), "SERTIFIKAT", number, holder, note,
  citation, place and date, the desks (each signer's own signature once signed), the sheet's QR
  and code. Before issue: no number and no QR. Never stored as files.
- **Cancel** the batch (as any letter): every sheet then verifies as cancelled.
- **Verification**: a sheet's code shows "certificate", the number, the holder's name in full
  (it is printed on the sheet), the note, the activity, the date, the unit, the signers; no
  file here (the pickup page gives the sheets; the page links to it).
- **Pickup (D5-P)**: `<WEB_URL>/certificates`, no sign-in. The holder types the e-mail given at
  registration; reCAPTCHA (action `certificate_pickup`) and the 20/minute verification limit
  apply. EXACT match through `emailHash` only (no lists, no partial search; at most 100 sheets),
  sheets of issued batches only (drafts, cancelled and deleted batches give nothing). Each sheet
  comes with a 15-minute link signed with LINK_SIGNING_SECRET (purpose `certificate-pickup`,
  the sheet's verification code) to admin `GET /certificates/pickup?t=…`, which re-checks the
  token and that the batch is issued, then renders the sheet (`attachment`). Bad, expired or
  foreign tokens are 404. Sheets without an e-mail cannot be picked up (the participants page
  says so per sheet).
- Code: `src/documents/certificates.ts`, `packages/db/src/sql/certificates.ts`,
  `apps/admin/src/server/certificates.ts`, `packages/pdf/src/certificate.ts`,
  `apps/web/src/server/verification.ts` (`createCertificatePickup`),
  `apps/web/src/app/certificates/**`, `apps/admin/src/app/certificates/pickup/route.ts`,
  `apps/admin/src/app/(panel)/letters/[id]/participants/page.tsx`.

## Personal signatures (D4)

From PPIDK `TandaTanganPengguna`: one image per person, printed on the letters they signed.

- **Own only**: `/account/signature` on the website (any signed-in person; the uid always comes
  from the session — nobody, not even a superadmin, sees or replaces another person's
  signature). PNG (best with a transparent background) or JPEG, ≤ 2 MB, magic bytes checked.
  Printed width 10-80 mm (default 40) and rotation -180..180 degrees clockwise (to straighten a
  skewed scan) can be changed without a new upload.
- **Encrypted**: the file is stored with `encryptField` (AES-256-GCM, `FIELD_ENCRYPTION_KEY`, the
  same key on web and admin) at `members/signatures/<uid>_<random>.enc`; `userSignatures/{uid}`
  records the path, type, width and rotation. A new upload is stored first, then the old file
  is removed. No key = signatures are off (upload refused, nothing printed).
- **On letters** (`apps/admin/src/server/letter-pdf.ts`): only on a desk that person has already
  signed, at the set width (never wider than the column), turned about its centre. The issued
  letter's archive freezes it: a later change never alters an issued letter. A missing record,
  a lost or undecryptable file, or an image pdf-lib cannot read prints the electronic-signature
  box instead — a signature never blocks a letter.
- Code: `src/documents/signatures.ts`, `packages/db/src/sql/signatures.ts`,
  `apps/web/src/server/signature.ts`, `apps/web/src/app/account/signature/**`,
  `apps/web/src/app/api/account/signature/route.ts`.

## Public verification (D7)

Anyone holding a letter checks it without signing in (PPIDK `VerifikasiController`):

- **Addresses**: `<WEB_URL>/verify` (type the code), `<WEB_URL>/verify/<CODE>` and, on
  `VERIFICATION_HOST` (the extra domain of the web app, e.g. `verif.ppiasiania.id`), the printed
  short form `/<CODE>` (and `/<CODE>/pdf`); any other path there shows the search page
  (`apps/web/src/lib/verification-host.ts`, rewrite in `apps/web/src/proxy.ts`). Never indexed.
  At most 20 requests per minute per IP on these paths.
- **Certificate sheets** (`certificateVerification`): see Certificates (D5).
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
  `createSqlVerificationReader`, `apps/web/src/server/verification.ts`, pages
  `apps/web/src/app/verify/**`. Not built: PPIDK's camera scanner (the phone's camera app opens
  the QR link directly).

## Incoming letters and dispositions (D6)

`src/documents/incoming.ts` (rules, from PPIDK `AgendaService`), `packages/db/src/sql/incoming.ts`,
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
`tests/unit/admin-incoming.test.ts`, `tests/integration/incoming.test.ts`,
`tests/integration/signatures.test.ts`, `tests/unit/pdf-stamp.test.ts`,
`tests/unit/certificates.test.ts`, `tests/unit/certificate-pdf.test.ts`,
`tests/integration/certificates.test.ts`.
