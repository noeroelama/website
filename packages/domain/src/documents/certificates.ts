import { safeText } from "@website/security/validation";
import { RuleViolationError } from "../shared";
import { formatNumber, type NumberValues } from "./numbering";

export interface Certificate {
  readonly id: string;
  readonly batchId: string;
  readonly periodId: string;
  readonly seq: number;
  readonly name: string;
  readonly note: string | null;
  readonly verificationCode: string;
  readonly emailHash: string | null;
  readonly createdAt: Date;
}

export interface Participant {
  readonly name: string;
  readonly note: string | null;
  readonly email: string | null;
}

export const CERTIFICATE_EMAIL_PURPOSE = "certificate-email";
export const CERTIFICATE_PICKUP_PURPOSE = "certificate-pickup";
export const CERTIFICATE_PICKUP_LINK_MS = 15 * 60_000;

export const CERTIFICATE_CHUNK = 200;
export const MAX_PARTICIPANT_LINES = 1000;

export const certificateId = (batchId: string, seq: number) =>
  `${batchId}_${String(seq).padStart(4, "0")}`;

const tidy = (text: string) => text.replace(/\s+/gu, " ").trim();
const Name = safeText(160);
const Note = safeText(160, { allowEmpty: true });
const SEPARATOR = /[\t;|]/u;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u;

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
