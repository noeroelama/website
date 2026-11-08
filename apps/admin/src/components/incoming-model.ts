import type { Disposition, IncomingLetter, IncomingStatus } from "@website/domain/documents";
import { DISPOSITION_STATUS_LABELS, INCOMING_STATUS_LABELS, label } from "../labels";

export const INCOMING_TABS = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "disposed", label: "Disposed" },
  { key: "done", label: "Done" },
  { key: "archived", label: "Archived" },
] as const;
export type IncomingTab = (typeof INCOMING_TABS)[number]["key"];

export interface DispositionItem {
  id: string;
  parentId: string | null;
  depth: number;
  from: string;
  to: string;
  instruction: string;
  dueDate: string | null;
  status: Disposition["status"];
  statusLabel: string;
  response: string | null;
  completedAt: string | null;
}

export interface IncomingItem {
  id: string;
  version: number;
  agendaNumber: string;
  sender: string;
  originNumber: string;
  subject: string;
  letterDate: string | null;
  receivedDate: string;
  summary: string;
  status: IncomingStatus;
  statusLabel: string;
  scanName: string | null;
  recordedBy: string;
  dispositions: DispositionItem[];
}

export function dispositionTree(
  dispositions: readonly Disposition[],
): Array<Disposition & { depth: number }> {
  const out: Array<Disposition & { depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const d of dispositions.filter((x) => x.parentId === parentId)) {
      out.push({ ...d, depth });
      walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function toIncomingItem(
  letter: IncomingLetter,
  names: ReadonlyMap<string, string>,
): IncomingItem {
  const name = (id: string | null) => (id ? (names.get(id) ?? id) : "");
  return {
    id: letter.id,
    version: letter.version,
    agendaNumber: letter.agendaNumber,
    sender: letter.sender,
    originNumber: letter.originNumber,
    subject: letter.subject,
    letterDate: letter.letterDate,
    receivedDate: letter.receivedDate,
    summary: letter.summary,
    status: letter.status,
    statusLabel: label(INCOMING_STATUS_LABELS, letter.status),
    scanName: letter.scan?.name ?? null,
    recordedBy: name(letter.recordedBy),
    dispositions: dispositionTree(letter.dispositions).map((d) => ({
      id: d.id,
      parentId: d.parentId,
      depth: d.depth,
      from: name(d.fromUserId),
      to: name(d.toOrgUnitId ?? d.toUserId),
      instruction: d.instruction,
      dueDate: d.dueDate,
      status: d.status,
      statusLabel: label(DISPOSITION_STATUS_LABELS, d.status),
      response: d.response,
      completedAt: d.completedAt?.toISOString() ?? null,
    })),
  };
}
