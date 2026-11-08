import { z } from "zod";
import { safeId, safeText } from "@website/security/validation";
import { RuleViolationError, type EntityMeta } from "../shared";

export const FINANCE_CATEGORIES = ["receipt", "disbursement", "reimbursement", "budget"] as const;
export type FinanceCategory = (typeof FINANCE_CATEGORIES)[number];

export const FINANCE_STATUSES = [
  "draft",
  "submitted",
  "reviewed",
  "authorized",
  "paid",
  "done",
  "revision",
  "rejected",
] as const;
export type FinanceStatus = (typeof FINANCE_STATUSES)[number];

export const FINANCE_DESKS = ["treasurer", "coordinator"] as const;
export type FinanceDesk = (typeof FINANCE_DESKS)[number];

export const FINANCE_CURRENCIES = [
  "IDR",
  "AUD",
  "CNY",
  "HKD",
  "JPY",
  "KRW",
  "MYR",
  "NZD",
  "PHP",
  "SGD",
  "THB",
  "TWD",
  "USD",
  "VND",
] as const;

export const MAX_FINANCE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FINANCE_DOCUMENTS = 10;

export const FinanceRequestInputSchema = z
  .object({
    category: z.enum(FINANCE_CATEGORIES),
    orgUnitId: safeId,
    title: safeText(200),
    description: safeText(2000, { multiline: true, allowEmpty: true }).default(""),
    amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    currency: z.enum(FINANCE_CURRENCIES),
    date: z.iso.date().nullable().default(null),
    account: safeText(150, { allowEmpty: true }).default(""),
    fundSource: safeText(100, { allowEmpty: true }).default(""),
    programId: safeId.nullable().default(null),
  })
  .strict();
export type FinanceRequestInput = z.infer<typeof FinanceRequestInputSchema>;

export interface FinanceFile {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
}

export interface DeskStamp {
  readonly uid: string;
  readonly at: Date;
  readonly note: string | null;
}

export interface FinancePayment {
  readonly uid: string;
  readonly at: Date;
  readonly amountMinor: number;
  readonly proof: FinanceFile;
}

export interface FinanceRequest extends FinanceRequestInput, EntityMeta {
  readonly periodId: string;
  readonly orgUnitPath: readonly string[];
  readonly status: FinanceStatus;
  readonly createdBy: string;
  readonly documents: readonly FinanceFile[];
  readonly submittedAt: Date | null;
  readonly treasurer: DeskStamp | null;
  readonly coordinator: DeskStamp | null;
  readonly revisionNote: string | null;
  readonly revisionRound: number;
  readonly rejection: DeskStamp | null;
  readonly payment: FinancePayment | null;
  readonly doneAt: Date | null;
}

export const financeFilePath = (
  request: Pick<FinanceRequest, "id" | "periodId">,
  kind: "doc" | "proof",
  uuid: string,
) => `finance/${request.periodId}/${request.id}_${kind}_${uuid.replace(/-/g, "").slice(0, 8)}.pdf`;

type Field = "title" | "amount" | "date" | "account" | "fundSource" | "documents";

export const REQUIRED_FIELDS: Readonly<Record<FinanceCategory, readonly Field[]>> = {
  receipt: ["title", "amount", "date", "account", "fundSource", "documents"],
  disbursement: ["title", "amount", "date", "account", "fundSource"],
  reimbursement: ["title", "amount", "account", "documents"],
  budget: ["title", "amount", "date", "documents"],
};

const FIELD_LABELS: Readonly<Record<Field, string>> = {
  title: "Title",
  amount: "Amount",
  date: "Date",
  account: "Destination account",
  fundSource: "Fund source",
  documents: "Documents (proposal, budget plan or receipts)",
};

const filled = (request: FinanceRequest, field: Field): boolean => {
  if (field === "amount") return request.amountMinor > 0;
  if (field === "documents") return request.documents.length > 0;
  if (field === "date") return request.date !== null;
  return request[field].trim() !== "";
};

export const missingFields = (request: FinanceRequest): string[] =>
  REQUIRED_FIELDS[request.category]
    .filter((field) => !filled(request, field))
    .map((field) => FIELD_LABELS[field]);

const refuse = (message: string): never => {
  throw new RuleViolationError(message);
};

function assertStatus(request: FinanceRequest, allowed: readonly FinanceStatus[], message: string) {
  if (!allowed.includes(request.status)) refuse(message);
}

function assertNotRequester(request: FinanceRequest, uid: string) {
  if (request.createdBy === uid) refuse("You cannot act at a desk on your own request.");
}

const noteOf = (note: string) => note.trim() || null;

export const isEditable = (request: Pick<FinanceRequest, "status">) =>
  request.status === "draft" || request.status === "revision";

export function submitRequest(request: FinanceRequest, now: Date): FinanceRequest {
  assertStatus(
    request,
    ["draft", "revision"],
    "Only drafts and returned requests can be submitted.",
  );
  const missing = missingFields(request);
  if (missing.length > 0) refuse(`Complete first: ${missing.join(", ")}.`);
  return { ...request, status: "submitted", submittedAt: now, revisionNote: null };
}

export function reviewRequest(
  request: FinanceRequest,
  uid: string,
  note: string,
  now: Date,
): FinanceRequest {
  assertStatus(request, ["submitted"], "This request is not submitted.");
  assertNotRequester(request, uid);
  return { ...request, status: "reviewed", treasurer: { uid, at: now, note: noteOf(note) } };
}

export function authorizeRequest(
  request: FinanceRequest,
  uid: string,
  note: string,
  now: Date,
): FinanceRequest {
  assertStatus(request, ["reviewed"], "The treasurer must review the request first.");
  assertNotRequester(request, uid);
  if (request.treasurer?.uid === uid) {
    refuse("The authorisation must come from a different person than the treasurer's review.");
  }
  return { ...request, status: "authorized", coordinator: { uid, at: now, note: noteOf(note) } };
}

const TURN: Readonly<Record<FinanceDesk, FinanceStatus>> = {
  treasurer: "submitted",
  coordinator: "reviewed",
};

function assertTurn(request: FinanceRequest, desk: FinanceDesk, uid: string) {
  assertStatus(request, [TURN[desk]], "This request is not at your desk.");
  assertNotRequester(request, uid);
}

export function returnRequest(
  request: FinanceRequest,
  desk: FinanceDesk,
  uid: string,
  note: string,
): FinanceRequest {
  assertTurn(request, desk, uid);
  if (!note.trim()) refuse("Say what must be fixed.");
  return {
    ...request,
    status: "revision",
    revisionNote: note.trim(),
    revisionRound: request.revisionRound + 1,
    treasurer: null,
    coordinator: null,
  };
}

export function rejectRequest(
  request: FinanceRequest,
  desk: FinanceDesk,
  uid: string,
  note: string,
  now: Date,
): FinanceRequest {
  assertTurn(request, desk, uid);
  if (!note.trim()) refuse("Give the reason for rejecting.");
  return { ...request, status: "rejected", rejection: { uid, at: now, note: note.trim() } };
}

export function markPaid(
  request: FinanceRequest,
  uid: string,
  amountMinor: number,
  proof: FinanceFile,
  now: Date,
): FinanceRequest {
  assertStatus(request, ["authorized"], "Only authorised requests can be marked paid.");
  assertNotRequester(request, uid);
  if (amountMinor <= 0) refuse("The amount paid must be more than zero.");
  return { ...request, status: "paid", payment: { uid, at: now, amountMinor, proof } };
}

export function completeRequest(request: FinanceRequest, now: Date): FinanceRequest {
  assertStatus(request, ["paid"], "Only paid requests can be completed.");
  return { ...request, status: "done", doneAt: now };
}

function assertEditable(request: FinanceRequest) {
  if (!isEditable(request)) refuse("Documents change only while the request is a draft.");
}

export function attachDocument(request: FinanceRequest, file: FinanceFile): FinanceRequest {
  assertEditable(request);
  if (request.documents.length >= MAX_FINANCE_DOCUMENTS) {
    refuse(`A request has at most ${MAX_FINANCE_DOCUMENTS} documents.`);
  }
  return { ...request, documents: [...request.documents, file] };
}

export function removeDocument(request: FinanceRequest, path: string): FinanceRequest {
  assertEditable(request);
  if (!request.documents.some((d) => d.path === path)) refuse("No such document.");
  return { ...request, documents: request.documents.filter((d) => d.path !== path) };
}
