import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { RuleViolationError, type EntityMeta } from "../shared";
import { romanMonth } from "./numbering";

/**
 * Incoming letters and dispositions (D6), ported from PPIDK `AgendaService`. A letter received
 * is recorded in the agenda book of the period (number given AT RECORDING: the letter is in hand,
 * so no number is ever left unused), then disposed to a unit or a person; recipients may forward
 * their disposition further down (the chain answers "where did it stop?"). A disposition closes
 * only when everything below it is done; the letter is done when every disposition is, and can
 * then be archived (no more dispositions).
 */
export const INCOMING_STATUSES = ["new", "disposed", "done", "archived"] as const;
export type IncomingStatus = (typeof INCOMING_STATUSES)[number];

export const DISPOSITION_STATUSES = ["waiting", "in_progress", "done"] as const;
export type DispositionStatus = (typeof DISPOSITION_STATUSES)[number];

/** Scans are private PDFs, at most 10 MB (PPIDK's limit). */
export const MAX_SCAN_BYTES = 10 * 1024 * 1024;

const plainDate = z.iso.date();

export const IncomingInputSchema = z
  .object({
    sender: safeText(200),
    /** The sender's own number. */
    originNumber: safeText(120, { allowEmpty: true }).default(""),
    subject: safeText(300),
    letterDate: plainDate.nullable().default(null),
    receivedDate: plainDate,
    summary: safeText(2000, { multiline: true, allowEmpty: true }).default(""),
  })
  .strict();
export type IncomingInput = z.infer<typeof IncomingInputSchema>;

export const DispositionInputSchema = z
  .object({
    /** One of the two: a unit of the period or a person. */
    toOrgUnitId: safeId.nullable(),
    toUserId: safeId.nullable(),
    instruction: safeText(1000, { multiline: true }),
    dueDate: plainDate.nullable().default(null),
    /** Forwarding an existing disposition (its id); null = from the letter itself. */
    parentId: safeId.nullable().default(null),
  })
  .strict();
export type DispositionInput = z.infer<typeof DispositionInputSchema>;

export interface ScanFile {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  /** Checked when the scan is opened: a swapped file is never shown. */
  readonly sha256: string;
}

export interface Disposition {
  readonly id: string;
  readonly parentId: string | null;
  readonly fromUserId: string;
  readonly toOrgUnitId: string | null;
  readonly toUserId: string | null;
  readonly instruction: string;
  readonly dueDate: string | null;
  readonly status: DispositionStatus;
  readonly response: string | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
}

export interface IncomingLetter extends IncomingInput, EntityMeta {
  readonly periodId: string;
  readonly agendaNumber: string;
  readonly status: IncomingStatus;
  readonly scan: ScanFile | null;
  readonly recordedBy: string;
  /** Kept on the letter (few per letter): one document, one transaction per change. */
  readonly dispositions: readonly Disposition[];
}

/** `042/AG/VIII/2026` from the sequence and the date received (PPIDK format). */
export function agendaNumber(seq: number, receivedDate: string): string {
  const [year, month] = receivedDate.split("-") as [string, string];
  return `${String(seq).padStart(3, "0")}/AG/${romanMonth(Number(month))}/${year}`;
}

const refuse = (message: string): never => {
  throw new RuleViolationError(message);
};

/** Dispose the letter, or forward one of its dispositions (`parentId`). */
export function dispose(
  letter: IncomingLetter,
  input: DispositionInput,
  fromUserId: string,
  id: string,
  now: Date,
): IncomingLetter {
  if (letter.status === "archived") refuse("An archived letter cannot be disposed again.");
  if ((input.toOrgUnitId === null) === (input.toUserId === null)) {
    refuse("Choose either a unit or a person.");
  }
  const parent = input.parentId ? letter.dispositions.find((d) => d.id === input.parentId) : null;
  if (input.parentId && !parent) refuse("That disposition is not part of this letter.");
  if (parent?.status === "done") refuse("A disposition that is done cannot be forwarded.");
  const disposition: Disposition = {
    id,
    parentId: input.parentId,
    fromUserId,
    toOrgUnitId: input.toOrgUnitId,
    toUserId: input.toUserId,
    instruction: input.instruction,
    dueDate: input.dueDate,
    status: "waiting",
    response: null,
    createdAt: now,
    completedAt: null,
  };
  return {
    ...letter,
    status: "disposed",
    dispositions: [
      // Forwarding keeps the parent responsible ("in progress"), it does not close it.
      ...letter.dispositions.map((d) =>
        d.id === input.parentId ? { ...d, status: "in_progress" as const } : d,
      ),
      disposition,
    ],
  };
}

/** A recipient reports the disposition done; never while something below it is open. */
export function completeDisposition(
  letter: IncomingLetter,
  dispositionId: string,
  response: string,
  now: Date,
): IncomingLetter {
  const target = letter.dispositions.find((d) => d.id === dispositionId);
  if (!target) return refuse("That disposition is not part of this letter.");
  if (target.status === "done") refuse("This disposition is already done.");
  if (letter.dispositions.some((d) => d.parentId === dispositionId && d.status !== "done")) {
    refuse("A disposition forwarded from this one is not done yet.");
  }
  const dispositions = letter.dispositions.map((d) =>
    d.id === dispositionId
      ? { ...d, status: "done" as const, response: response.trim() || null, completedAt: now }
      : d,
  );
  return {
    ...letter,
    dispositions,
    status: dispositions.every((d) => d.status === "done") ? "done" : letter.status,
  };
}

/** Archived letters are read-only; only when every disposition is done. */
export function archiveIncoming(letter: IncomingLetter): IncomingLetter {
  if (letter.status === "archived") refuse("This letter is already archived.");
  if (letter.dispositions.some((d) => d.status !== "done")) {
    refuse("A disposition of this letter is not done yet.");
  }
  return { ...letter, status: "archived" };
}

/** Private Storage path of a scan. */
export const scanPath = (periodId: string, letterId: string, uuid: string) =>
  `letters/incoming/${periodId}/${letterId}_${uuid.replace(/-/g, "").slice(0, 8)}.pdf`;
