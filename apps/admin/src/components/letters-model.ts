import {
  desksOf,
  isEditable,
  type Letter,
  type LetterStatus,
  type LetterSource,
  type LetterType,
  type UploadPlacement,
} from "@website/domain/documents";
import { LETTER_STATUS_LABELS, label } from "../labels";

export const LETTER_TABS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "review", label: "To correct" },
  { key: "corrected", label: "To sign" },
  { key: "approved", label: "To issue" },
  { key: "issued", label: "Issued" },
  { key: "cancelled", label: "Cancelled" },
] as const;
export type LetterTab = (typeof LETTER_TABS)[number]["key"];

export function matchesLetterTab(item: Pick<LetterItem, "status">, tab: LetterTab): boolean {
  if (tab === "all") return true;
  if (tab === "approved") return item.status === "approved" || item.status === "awaiting_file";
  return item.status === tab;
}

export interface LetterDesks {
  readonly review: boolean;
  readonly sign: boolean;
  readonly signCoordinator: boolean;
  readonly issue: boolean;
  readonly cancel: boolean;
}

export interface DeskItem {
  uid: string;
  name: string;
  at: string;
}

export interface LetterItem {
  id: string;
  version: number;
  typeId: string;
  typeName: string;
  typeCode: string;
  orgUnitId: string;
  unitName: string;
  subject: string;
  body: string;
  recipient: string;
  place: string;
  attachmentNote: string;
  letterDate: string | null;
  activityCode: string | null;
  status: LetterStatus;
  statusLabel: string;
  requiresCoordinator: boolean;
  requiresRecipient: boolean;
  createdBy: string;
  authorName: string;
  reviewNote: string | null;
  secretary: DeskItem | null;
  coordinator: DeskItem | null;
  numberFormatted: string | null;
  verificationCode: string | null;
  issuedAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  source: LetterSource;
  upload: { size: number; numberChecked: boolean; uploadedAt: string } | null;
  placement: UploadPlacement | null;
  canEdit: boolean;
}

export function toLetterItem(
  letter: Letter,
  type: LetterType | undefined,
  unitName: string,
  names: ReadonlyMap<string, string>,
  canEdit: boolean,
): LetterItem {
  const desk = (signature: Letter["secretary"]): DeskItem | null =>
    signature
      ? {
          uid: signature.uid,
          name: names.get(signature.uid) ?? signature.uid,
          at: signature.at.toISOString(),
        }
      : null;
  return {
    id: letter.id,
    version: letter.version,
    typeId: letter.typeId,
    typeName: type?.name ?? "",
    typeCode: type?.code ?? "",
    orgUnitId: letter.orgUnitId,
    unitName,
    subject: letter.subject,
    body: letter.body,
    recipient: letter.recipient,
    place: letter.place,
    attachmentNote: letter.attachmentNote,
    letterDate: letter.letterDate,
    activityCode: letter.activityCode,
    status: letter.status,
    statusLabel: label(LETTER_STATUS_LABELS, letter.status),
    requiresCoordinator: type?.requiresCoordinator ?? false,
    requiresRecipient: type?.requiresRecipient ?? true,
    createdBy: letter.createdBy,
    authorName: names.get(letter.createdBy) ?? letter.createdBy,
    reviewNote: letter.reviewNote,
    secretary: desk(letter.secretary),
    coordinator: desk(letter.coordinator),
    numberFormatted: letter.numberFormatted,
    verificationCode: letter.verificationCode,
    issuedAt: letter.issuedAt?.toISOString() ?? null,
    cancelReason: letter.cancelReason,
    createdAt: letter.createdAt.toISOString(),
    source: letter.source,
    upload: letter.upload && {
      size: letter.upload.size,
      numberChecked: letter.upload.numberChecked,
      uploadedAt: letter.upload.uploadedAt.toISOString(),
    },
    placement: letter.placement,
    canEdit,
  };
}

export type LetterActionKey =
  | "edit"
  | "submit"
  | "delete"
  | "pass"
  | "return"
  | "signSecretary"
  | "signCoordinator"
  | "issue"
  | "issueFile"
  | "cancel";

export function letterActions(
  item: LetterItem,
  can: LetterDesks,
  viewerId: string,
): LetterActionKey[] {
  const actions: LetterActionKey[] = [];
  const { status } = item;
  if (item.canEdit && isEditable(item)) actions.push("edit");
  if (item.canEdit && status === "draft") actions.push("submit", "delete");
  if (can.review && status === "review") actions.push("pass");
  if (can.review && (status === "review" || status === "corrected" || status === "approved")) {
    actions.push("return");
  }
  if (status === "corrected") {
    if (can.sign && item.secretary === null && item.coordinator?.uid !== viewerId) {
      actions.push("signSecretary");
    }
    const hasCoordinatorDesk = desksOf(item).includes("coordinator");
    if (
      can.signCoordinator &&
      hasCoordinatorDesk &&
      item.coordinator === null &&
      item.secretary?.uid !== viewerId
    ) {
      actions.push("signCoordinator");
    }
  }
  if (can.issue && status === "approved") actions.push("issue");
  if (can.issue && status === "awaiting_file" && item.upload) actions.push("issueFile");
  if (can.cancel && (status === "issued" || status === "awaiting_file")) actions.push("cancel");
  return actions;
}
