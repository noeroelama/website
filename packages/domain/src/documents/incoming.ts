import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { RuleViolationError, type EntityMeta } from "../shared";
import { romanMonth } from "./numbering";

export const INCOMING_STATUSES = ["new", "disposed", "done", "archived"] as const;
export type IncomingStatus = (typeof INCOMING_STATUSES)[number];

export const DISPOSITION_STATUSES = ["waiting", "in_progress", "done"] as const;
export type DispositionStatus = (typeof DISPOSITION_STATUSES)[number];

export const MAX_SCAN_BYTES = 10 * 1024 * 1024;

const plainDate = z.iso.date();

export const IncomingInputSchema = z
  .object({
    sender: safeText(200),
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
    toOrgUnitId: safeId.nullable(),
    toUserId: safeId.nullable(),
    instruction: safeText(1000, { multiline: true }),
    dueDate: plainDate.nullable().default(null),
    parentId: safeId.nullable().default(null),
  })
  .strict();
export type DispositionInput = z.infer<typeof DispositionInputSchema>;

export interface ScanFile {
  readonly path: string;
  readonly name: string;
  readonly size: number;
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
  readonly dispositions: readonly Disposition[];
}

export function agendaNumber(seq: number, receivedDate: string): string {
  const [year, month] = receivedDate.split("-") as [string, string];
  return `${String(seq).padStart(3, "0")}/AG/${romanMonth(Number(month))}/${year}`;
}

const refuse = (message: string): never => {
  throw new RuleViolationError(message);
};

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
      ...letter.dispositions.map((d) =>
        d.id === input.parentId ? { ...d, status: "in_progress" as const } : d,
      ),
      disposition,
    ],
  };
}

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

export function archiveIncoming(letter: IncomingLetter): IncomingLetter {
  if (letter.status === "archived") refuse("This letter is already archived.");
  if (letter.dispositions.some((d) => d.status !== "done")) {
    refuse("A disposition of this letter is not done yet.");
  }
  return { ...letter, status: "archived" };
}

export const scanPath = (periodId: string, letterId: string, uuid: string) =>
  `letters/incoming/${periodId}/${letterId}_${uuid.replace(/-/g, "").slice(0, 8)}.pdf`;
