import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { RuleViolationError, type EntityMeta } from "../shared";
import type { Letterhead } from "./letterhead";
import { checkNumberPattern } from "./numbering";

/**
 * Outgoing letters (D1, D2), ported from PPIDK `SuratService`:
 *
 *   draft ─→ review ─→ corrected ─→ (desks) ─→ approved ─→ issued ─→ cancelled
 *     ↑________________________________|  returned with a note (clears both desks)
 *
 * The secretariat corrects (review → corrected) before anyone may sign; types that require it
 * need the Coordinator's desk as well as the Secretary-General's, and ONE person never holds
 * both. The number is given only at issue (no gaps from abandoned drafts) and never reused.
 */
export const LETTER_STATUSES = [
  "draft",
  "review",
  "corrected",
  "approved",
  /** Upload path (step 4.7): numbered, waiting for the final PDF. */
  "awaiting_file",
  "issued",
  "cancelled",
] as const;
export type LetterStatus = (typeof LETTER_STATUSES)[number];

/** editor = typed here and rendered; upload = own PDF (4.7); certificate = batch (4.8). */
export const LETTER_SOURCES = ["editor", "upload", "certificate"] as const;
export type LetterSource = (typeof LETTER_SOURCES)[number];

export const DESKS = ["secretary", "coordinator"] as const;
export type Desk = (typeof DESKS)[number];

const plainDate = z.iso.date();

/** Letter type (master data across periods; the counter is per period and type). */
export const LetterTypeInputSchema = z
  .object({
    name: safeText(120),
    /** Goes into the number via {jenis}: trimmed (PPIDK once stored "SPm " with a space). */
    code: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{1,12}$/, "Use 1-12 letters, digits or '-'."),
    description: safeText(500, { multiline: true, allowEmpty: true }).default(""),
    numberFormat: z
      .string()
      .trim()
      .max(120)
      .superRefine((value, ctx) => {
        const problem = checkNumberPattern(value);
        if (problem) ctx.addIssue({ code: "custom", message: problem });
      }),
    numberPadding: z.number().int().min(1).max(6).default(3),
    requiresCoordinator: z.boolean().default(false),
    requiresRecipient: z.boolean().default(true),
    /** false = the verification page shows the content only to who types the recipient. */
    contentPublic: z.boolean().default(true),
    active: z.boolean().default(true),
    sort: z.number().int().min(0).max(9999).default(0),
  })
  .strict();
export type LetterTypeInput = z.infer<typeof LetterTypeInputSchema>;
export type LetterType = LetterTypeInput & EntityMeta;

/** Draft fields. The body is sanitized rich text (sanitizeRichText on save, by the server). */
export const LetterInputSchema = z
  .object({
    typeId: safeId,
    /** Issuing unit of the letter's period (its code goes into {unit}); central letters use the
     * Secretariat-General's unit, as in PPIDK. */
    orgUnitId: safeId,
    subject: safeText(200),
    body: z.string().max(100_000).default(""),
    recipient: safeText(160, { allowEmpty: true }).default(""),
    place: safeText(80, { allowEmpty: true }).default(""),
    attachmentNote: safeText(120, { allowEmpty: true }).default(""),
    letterDate: plainDate.nullable(),
    /** {kode_kegiatan} of the number (certificate batches: "LKMM"); null when not used. */
    activityCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{1,24}$/, "Use 1-24 letters, digits or '-'.")
      .nullable()
      .default(null),
  })
  .strict();
export type LetterInput = z.infer<typeof LetterInputSchema>;

export interface DeskSignature {
  readonly uid: string;
  readonly at: Date;
}

/** Who signed, frozen at issue: the letter keeps meaning after people leave office. */
export interface SignerSnapshot {
  readonly name: string;
  /** The desk printed on the letter ("Sekretaris Jenderal PPIDK Asia-Oseania"). */
  readonly desk: string;
  /** Their seat in the structure at that time, if any. */
  readonly position: string | null;
  readonly period: string | null;
  readonly at: Date;
}

export interface Letter extends LetterInput, EntityMeta {
  readonly periodId: string;
  /** The unit and its ancestors (scope checks: a director sees only their unit's letters). */
  readonly orgUnitPath: readonly string[];
  readonly status: LetterStatus;
  readonly source: LetterSource;
  readonly createdBy: string;
  readonly reviewedBy: string | null;
  readonly reviewNote: string | null;
  readonly secretary: DeskSignature | null;
  readonly coordinator: DeskSignature | null;
  readonly number: number | null;
  readonly numberFormatted: string | null;
  readonly verificationCode: string | null;
  readonly issuedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly cancelReason: string | null;
  /** sha256 of `letterCanonical` at issue; a mismatch means the stored text was changed. */
  readonly contentDigest: string | null;
  readonly signers: readonly SignerSnapshot[];
  /** The letterhead as it was at issue (null until issued). */
  readonly letterhead: Letterhead | null;
  /** The issued PDF in private Storage, kept byte for byte (null until rendered). */
  readonly archive: LetterArchive | null;
  /** Upload path (D3): the author's final PDF while `awaiting_file` (null otherwise). */
  readonly upload: UploadedLetterFile | null;
  /** Upload path: where the signatures and the QR are stamped on that PDF. */
  readonly placement: UploadPlacement | null;
  /** Certificate batches: the sheets' number, frozen at issue (`sheetNumber`). */
  readonly sheetNumberTemplate: string | null;
}

export interface UploadedLetterFile extends LetterArchive {
  /** false = the PDF has no text layer (a scan): the number could not be checked. */
  readonly numberChecked: boolean;
  readonly uploadedBy: string;
  readonly uploadedAt: Date;
}

/** Upload path (D3): the final PDF may be at most 10 MB. */
export const MAX_LETTER_UPLOAD_BYTES = 10 * 1024 * 1024;

const page = z.number().int().min(1).max(500);
const mm = z.number().min(0).max(420);
const Spot = z.object({ page, xMm: mm, yMm: mm }).strict();

/**
 * Upload path: where things are stamped, in mm from the page's top-left corner (as PPIDK's
 * `penempatan_ttd`). Each signature uses its owner's width; the QR carries the code under it.
 */
export const UploadPlacementSchema = z
  .object({
    qr: Spot.extend({ sizeMm: z.number().min(15).max(40) }).nullable(),
    secretary: Spot.nullable(),
    coordinator: Spot.nullable(),
  })
  .strict();
export type UploadPlacement = z.infer<typeof UploadPlacementSchema>;

export interface LetterArchive {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

/** Private Storage path of a letter's archived PDF (a fresh name per render: never overwritten). */
export const letterArchivePath = (letter: Pick<Letter, "id" | "periodId">, uuid: string) =>
  `letters/${letter.periodId}/${letter.id}_${uuid.replace(/-/g, "").slice(0, 8)}.pdf`;

/** Private Storage path of an uploaded final PDF (a fresh name per upload). */
export const letterUploadPath = (letter: Pick<Letter, "id" | "periodId">, uuid: string) =>
  `letters/${letter.periodId}/${letter.id}_upload_${uuid.replace(/-/g, "").slice(0, 8)}.pdf`;

const refuse = (message: string): never => {
  throw new RuleViolationError(message);
};

function assertStatus(letter: Letter, allowed: readonly LetterStatus[], message: string) {
  if (!allowed.includes(letter.status)) refuse(message);
}

/** Only drafts and letters under review may be edited (issued letters exist on paper). */
export const isEditable = (letter: Pick<Letter, "status">) =>
  letter.status === "draft" || letter.status === "review";

/** The draft fields as saved: a type without recipient clears it (D2). */
export function normalizeLetterInput(input: LetterInput, type: LetterType): LetterInput {
  return type.requiresRecipient ? input : { ...input, recipient: "" };
}

/** Checked when submitted, not at issue: a missing field found at the desk wastes a round. */
export function missingFields(letter: Letter, type: LetterType): string[] {
  return [
    !letter.subject.trim() && "Subject",
    letter.source === "editor" && !letter.body.trim() && "Body",
    !letter.letterDate && "Letter date",
    type.requiresRecipient && !letter.recipient.trim() && "Recipient",
    type.numberFormat.includes("{kode_kegiatan}") && !letter.activityCode && "Activity code",
  ].filter((field): field is string => typeof field === "string");
}

function assertComplete(letter: Letter, type: LetterType) {
  const missing = missingFields(letter, type);
  if (missing.length > 0) refuse(`Complete first: ${missing.join(", ")}.`);
}

export function submitForReview(letter: Letter, type: LetterType): Letter {
  assertStatus(letter, ["draft"], "Only drafts can be submitted for review.");
  assertComplete(letter, type);
  return { ...letter, status: "review" };
}

/** The secretariat passes the correction: the hard gate before anyone may sign. */
export function passReview(letter: Letter, type: LetterType, uid: string): Letter {
  assertStatus(letter, ["review"], "Only letters under review can be passed.");
  assertComplete(letter, type);
  return { ...letter, status: "corrected", reviewedBy: uid };
}

/** Back to draft with a note; both desks are cleared (it is no longer what they approved). */
export function returnLetter(letter: Letter, uid: string, note: string): Letter {
  assertStatus(
    letter,
    ["review", "corrected", "approved"],
    "Only letters in review, corrected or approved can be returned.",
  );
  if (!note.trim()) refuse("Say what must be fixed.");
  return {
    ...letter,
    status: "draft",
    reviewedBy: uid,
    reviewNote: note.trim(),
    secretary: null,
    coordinator: null,
  };
}

/** Desks this type needs. */
export const desksOf = (type: Pick<LetterType, "requiresCoordinator">): readonly Desk[] =>
  type.requiresCoordinator ? DESKS : ["secretary"];

/** One desk approves; the letter becomes `approved` when every desk of its type has. */
export function signDesk(
  letter: Letter,
  type: LetterType,
  desk: Desk,
  uid: string,
  now: Date,
): Letter {
  assertStatus(letter, ["corrected"], "The secretariat must pass the letter before it is signed.");
  if (!desksOf(type).includes(desk)) refuse("This letter type has no Coordinator desk.");
  if (letter[desk]) refuse("This desk has already signed.");
  const other = desk === "secretary" ? letter.coordinator : letter.secretary;
  if (other?.uid === uid) refuse("One person cannot hold both signing desks of a letter.");
  const signed = { ...letter, [desk]: { uid, at: now } };
  const complete = desksOf(type).every((d) => signed[d] !== null);
  return complete ? { ...signed, status: "approved" } : signed;
}

/** Issued (or numbered upload) letters may be cancelled; the number is never given back. */
export function cancelLetter(letter: Letter, reason: string, now: Date): Letter {
  assertStatus(letter, ["issued", "awaiting_file"], "Only numbered letters can be cancelled.");
  if (!reason.trim()) refuse("Give the reason: it is shown on the public verification page.");
  return { ...letter, status: "cancelled", cancelledAt: now, cancelReason: reason.trim() };
}

/** Fewer characters than this = no text layer (scanners add a little junk text). */
const TEXT_LAYER_MIN = 40;
const squash = (text: string) => text.replace(/\s+/gu, "").toUpperCase();

/**
 * Upload path (PPIDK `UnggahDokumen::periksaNomor`): the author TYPED the number into the
 * document, the one place a number can be wrong. A PDF with text must contain it (spaces
 * ignored: extractors split "001 / SOP / ..."); a PDF without text (a scan) is accepted as not
 * checked. Returns whether it was checked.
 */
export function checkUploadedNumber(text: string, number: string): boolean {
  if (text.trim().length < TEXT_LAYER_MIN) return false;
  if (!squash(text).includes(squash(number))) {
    refuse(
      `Number ${number} is not in the file. Type it into the document and export the PDF again.`,
    );
  }
  return true;
}

function assertAwaitingFile(letter: Letter) {
  assertStatus(letter, ["awaiting_file"], "This letter is not waiting for its file.");
}

/** A new final PDF replaces the previous one (until it is issued). */
export function attachUpload(letter: Letter, file: UploadedLetterFile): Letter {
  assertAwaitingFile(letter);
  return { ...letter, upload: file };
}

export function placeStamps(letter: Letter, placement: UploadPlacement): Letter {
  assertAwaitingFile(letter);
  return { ...letter, placement };
}

/**
 * awaiting_file → issued with the stamped PDF as its archive. `stampedFrom` is the sha256 of the
 * upload that was stamped: a newer upload in between refuses (stamp it again).
 */
export function issueUpload(
  letter: Letter,
  archive: LetterArchive,
  stampedFrom: string,
  now: Date,
): Letter {
  assertAwaitingFile(letter);
  if (!letter.upload) refuse("Upload the final PDF first.");
  if (letter.upload?.sha256 !== stampedFrom) refuse("The file changed meanwhile. Issue it again.");
  return { ...letter, status: "issued", issuedAt: now, archive };
}

/** The desk names printed on the letter (and frozen in `signers`). */
export function deskLabel(desk: Desk, type: LetterType, unitName: string | null): string {
  if (desk === "coordinator") return "Koordinator PPIDK Asia-Oseania";
  return type.requiresCoordinator
    ? "Sekretaris Jenderal PPIDK Asia-Oseania"
    : (unitName ?? "PPIDK Asia-Oseania");
}

/**
 * Text hashed into `contentDigest` at issue (PPIDK `SidikSurat`): frozen values only, fields
 * joined with a unit separator (so "AB"+"C" ≠ "A"+"BC"), line endings unified and ends trimmed
 * (a browser swapping \r\n for \n must not look like tampering).
 */
export function letterCanonical(letter: Letter, typeCode: string): string {
  const tidy = (value: string) => value.replace(/\r\n?/g, "\n").trim();
  return [
    ["number", letter.numberFormatted ?? ""],
    ["date", letter.letterDate ?? ""],
    ["type", typeCode],
    ["subject", tidy(letter.subject)],
    ["recipient", tidy(letter.recipient)],
    ["body", tidy(letter.body)],
    ["secretary", letter.secretary?.uid ?? ""],
    ["coordinator", letter.coordinator?.uid ?? ""],
  ]
    .map(([key, value]) => `${key}=${value}`)
    .join("\x1f");
}

/** Readable alphabet without I L O 0 1: codes are typed from paper. */
export const VERIFICATION_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;

/** `8F3KM-QRTVW` from 10 random indexes (`random(n)` returns 0..n-1). */
export function makeVerificationCode(random: (n: number) => number): string {
  const chars = Array.from(
    { length: 10 },
    () => VERIFICATION_ALPHABET[random(VERIFICATION_ALPHABET.length)],
  ).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

/** A typed or scanned code in its stored form, or null when it cannot be one. */
export function normalizeVerificationCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  return CODE.test(code) ? code : null;
}
