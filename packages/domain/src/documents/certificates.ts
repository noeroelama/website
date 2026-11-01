import { safeText } from "@website/security/validation";
import { RuleViolationError } from "../shared";
import { formatNumber, type NumberValues } from "./numbering";

/**
 * Mass certificates (D5, PPIDK `SertifikatService`): a batch is a letter (`source:
 * "certificate"`) with ONE agenda number; each participant is a sheet `certificates/{id}` with
 * its own sequence (`007.037/...`) and its own verification code. Sheets are not stored as
 * files: they are rendered on demand from the batch frozen at issue.
 */
export interface Certificate {
  readonly id: string;
  readonly batchId: string;
  readonly periodId: string;
  /** 1, 2, ... in the order added; never reused or renumbered. */
  readonly seq: number;
  readonly name: string;
  /** "Narasumber", "Juara 1"; null for most participants. */
  readonly note: string | null;
  readonly verificationCode: string;
  /** keyedHash(CERTIFICATE_EMAIL_PURPOSE, e-mail) for the pickup page (D5-P); null = none. */
  readonly emailHash: string | null;
  readonly createdAt: Date;
}

export interface Participant {
  readonly name: string;
  readonly note: string | null;
  /** Lower case; turned into `emailHash` before it is stored (never stored itself). */
  readonly email: string | null;
}

/** keyedHash purpose of `emailHash` (the same on admin and web, SUBSCRIBER_HASH_SECRET). */
export const CERTIFICATE_EMAIL_PURPOSE = "certificate-email";
/** signLink purpose of the 15-minute pickup download link (LINK_SIGNING_SECRET). */
export const CERTIFICATE_PICKUP_PURPOSE = "certificate-pickup";
export const CERTIFICATE_PICKUP_LINK_MS = 15 * 60_000;

/** At most this many sheets are written in one transaction (keeps one transaction small). */
export const CERTIFICATE_CHUNK = 200;
/** At most this many lines in one paste. */
export const MAX_PARTICIPANT_LINES = 1000;

export const certificateId = (batchId: string, seq: number) =>
  `${batchId}_${String(seq).padStart(4, "0")}`;

const tidy = (text: string) => text.replace(/\s+/gu, " ").trim();
const Name = safeText(160);
const Note = safeText(160, { allowEmpty: true });
const SEPARATOR = /[\t;|]/u;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u;

/**
 * A pasted list (from Excel or Google Sheets): one person per line, an optional note after the
 * first TAB, `;` or `|`. Never a comma: Indonesian names carry degrees ("Arif, S.Kom.").
 * A column that is an e-mail address (anywhere after the name) is the pickup e-mail, not the note.
 * Duplicates are KEPT: two people may share a name, and a wrong extra line is easy to delete,
 * while a silently dropped person never gets a certificate.
 */
export function parseParticipants(text: string): Participant[] {
  const lines = text.split(/\r\n|\r|\n/u);
  if (lines.length > MAX_PARTICIPANT_LINES) {
    throw new RuleViolationError(`Paste at most ${MAX_PARTICIPANT_LINES} lines at once.`);
  }
  return lines.flatMap((raw, i) => {
    const cells = raw.split(SEPARATOR);
    const emailCell = cells.slice(1).find((cell) => EMAIL.test(cell.trim()) && cell.length <= 254);
    const line = emailCell === undefined ? raw : cells.filter((c) => c !== emailCell).join("\t");
    const [first = "", ...rest] = line.split(/[\t;|]+/u);
    const name = tidy(first);
    if (!name) return [];
    const note = tidy(line.slice(line.search(SEPARATOR) + 1).replace(/^[\t;|]+/u, ""));
    const parsed = { name: Name.safeParse(name), note: Note.safeParse(rest.length ? note : "") };
    if (!parsed.name.success || !parsed.note.success) {
      throw new RuleViolationError(
        `Line ${i + 1}: names and notes are text of at most 160 characters.`,
      );
    }
    return [
      {
        name: parsed.name.data,
        note: parsed.note.data || null,
        email: emailCell?.trim().toLowerCase() ?? null,
      },
    ];
  });
}

const PARTICLES = new Set(["bin", "binti", "van", "von", "de", "da", "di", "der"]);
const capital = (part: string) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();

/**
 * "ARIF NURWAHID, S.KOM." → "Arif Nurwahid, S.KOM.": the optional "Title case" of a paste.
 * Degrees (a dot inside the word) stay as typed; particles stay small except first.
 */
export function titleCaseName(name: string): string {
  return tidy(name)
    .split(" ")
    .map((word, i) => {
      if (/\p{L}\.\p{L}/u.test(word)) return word;
      if (i > 0 && PARTICLES.has(word.toLowerCase())) return word.toLowerCase();
      return word.split("-").map(capital).join("-");
    })
    .join(" ");
}

/**
 * The batch number with the sheet's place left open (`007.{sheet:3}/SERT/...`), frozen at issue:
 * a later change to the type's pattern never renumbers printed sheets.
 */
export function sheetNumberTemplate(pattern: string, values: Omit<NumberValues, "sheet">): string {
  return formatNumber(pattern.replaceAll("{nomor}", "\u0000"), values).replaceAll(
    "\u0000",
    `${String(values.seq).padStart(values.padding, "0")}.{sheet:${values.padding}}`,
  );
}

export function sheetNumber(template: string | null, seq: number): string | null {
  return (
    template?.replace(/\{sheet:(\d)\}/gu, (_, digits: string) =>
      String(seq).padStart(Number(digits), "0"),
    ) ?? null
  );
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  nbsp: " ",
};

/** The sentence under the name: the batch text as plain lines, or PPIDK's default. */
export function certificateCitation(bodyHtml: string, subject: string): string {
  const text = bodyHtml
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/giu, "\n")
    .replace(/<[^>]*>/gu, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/gu, (_, name: string) => ENTITIES[name] as string)
    .split("\n")
    .map(tidy)
    .filter(Boolean)
    .join("\n");
  return text || `atas partisipasinya dalam kegiatan ${subject}`;
}
