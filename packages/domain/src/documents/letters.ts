import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { RuleViolationError, type EntityMeta } from "../shared";
import type { Letterhead } from "./letterhead";
import { checkNumberPattern } from "./numbering";

export const LETTER_STATUSES = [
  "draft",
  "review",
  "corrected",
  "approved",
  "awaiting_file",
  "issued",
  "cancelled",
] as const;
export type LetterStatus = (typeof LETTER_STATUSES)[number];

export const LETTER_SOURCES = ["editor", "upload", "certificate"] as const;
export type LetterSource = (typeof LETTER_SOURCES)[number];

export const DESKS = ["secretary", "coordinator"] as const;
export type Desk = (typeof DESKS)[number];

const plainDate = z.iso.date();

export const LetterTypeInputSchema = z
  .object({
    name: safeText(120),
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
    contentPublic: z.boolean().default(true),
    active: z.boolean().default(true),
    sort: z.number().int().min(0).max(9999).default(0),
  })
  .strict();
export type LetterTypeInput = z.infer<typeof LetterTypeInputSchema>;
export type LetterType = LetterTypeInput & EntityMeta;

export const LetterInputSchema = z
  .object({
    typeId: safeId,
    orgUnitId: safeId,
    subject: safeText(200),
    body: z.string().max(100_000).default(""),
    recipient: safeText(160, { allowEmpty: true }).default(""),
    place: safeText(80, { allowEmpty: true }).default(""),
    attachmentNote: safeText(120, { allowEmpty: true }).default(""),
    letterDate: plainDate.nullable(),
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

export interface SignerSnapshot {
  readonly name: string;
  readonly desk: string;
  readonly position: string | null;
  readonly period: string | null;
  readonly at: Date;
}

export interface Letter extends LetterInput, EntityMeta {
  readonly periodId: string;
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
  readonly contentDigest: string | null;
  readonly signers: readonly SignerSnapshot[];
  readonly letterhead: Letterhead | null;
  readonly archive: LetterArchive | null;
  readonly upload: UploadedLetterFile | null;
  readonly placement: UploadPlacement | null;
  readonly sheetNumberTemplate: string | null;
}

export interface UploadedLetterFile extends LetterArchive {
  readonly numberChecked: boolean;
  readonly uploadedBy: string;
  readonly uploadedAt: Date;
}

export const MAX_LETTER_UPLOAD_BYTES = 10 * 1024 * 1024;

const page = z.number().int().min(1).max(500);
const mm = z.number().min(0).max(420);
const Spot = z.object({ page, xMm: mm, yMm: mm }).strict();

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

export const letterArchivePath = (letter: Pick<Letter, "id" | "periodId">, uuid: string) =>
  `letters/${letter.periodId}/${letter.id}_${uuid.replace(/-/g, "").slice(0, 8)}.pdf`;

export const letterUploadPath = (letter: Pick<Letter, "id" | "periodId">, uuid: string) =>
  `letters/${letter.periodId}/${letter.id}_upload_${uuid.replace(/-/g, "").slice(0, 8)}.pdf`;

const refuse = (message: string): never => {
  throw new RuleViolationError(message);
};

function assertStatus(letter: Letter, allowed: readonly LetterStatus[], message: string) {
  if (!allowed.includes(letter.status)) refuse(message);
}

export const isEditable = (letter: Pick<Letter, "status">) =>
  letter.status === "draft" || letter.status === "review";

export function normalizeLetterInput(input: LetterInput, type: LetterType): LetterInput {
  return type.requiresRecipient ? input : { ...input, recipient: "" };
}

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

export function passReview(letter: Letter, type: LetterType, uid: string): Letter {
  assertStatus(letter, ["review"], "Only letters under review can be passed.");
  assertComplete(letter, type);
  return { ...letter, status: "corrected", reviewedBy: uid };
}

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

export const desksOf = (type: Pick<LetterType, "requiresCoordinator">): readonly Desk[] =>
  type.requiresCoordinator ? DESKS : ["secretary"];

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

export function cancelLetter(letter: Letter, reason: string, now: Date): Letter {
  assertStatus(letter, ["issued", "awaiting_file"], "Only numbered letters can be cancelled.");
  if (!reason.trim()) refuse("Give the reason: it is shown on the public verification page.");
  return { ...letter, status: "cancelled", cancelledAt: now, cancelReason: reason.trim() };
}

const TEXT_LAYER_MIN = 40;
const squash = (text: string) => text.replace(/\s+/gu, "").toUpperCase();

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

export function attachUpload(letter: Letter, file: UploadedLetterFile): Letter {
  assertAwaitingFile(letter);
  return { ...letter, upload: file };
}

export function placeStamps(letter: Letter, placement: UploadPlacement): Letter {
  assertAwaitingFile(letter);
  return { ...letter, placement };
}

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

export function deskLabel(desk: Desk, type: LetterType, unitName: string | null): string {
  if (desk === "coordinator") return "Koordinator PPIDK Asia-Oseania";
  return type.requiresCoordinator
    ? "Sekretaris Jenderal PPIDK Asia-Oseania"
    : (unitName ?? "PPIDK Asia-Oseania");
}

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

export const VERIFICATION_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;

export function makeVerificationCode(random: (n: number) => number): string {
  const chars = Array.from(
    { length: 10 },
    () => VERIFICATION_ALPHABET[random(VERIFICATION_ALPHABET.length)],
  ).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

export function normalizeVerificationCode(input: string): string | null {
  const code = input.trim().toUpperCase();
  return CODE.test(code) ? code : null;
}
