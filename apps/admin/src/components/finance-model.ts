import {
  CASH_CATEGORY_LABELS,
  type CurrencyReport,
  type FinanceCategory,
  type FinanceRequest,
  type FinanceStatus,
} from "@website/domain/finance";
import { formatMoney, majorText } from "@website/domain/shared";
import { FINANCE_CATEGORY_LABELS, FINANCE_STATUS_LABELS, label } from "../labels";

export const FINANCE_TABS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Drafts" },
  { key: "desks", label: "At a desk" },
  { key: "authorized", label: "To pay" },
  { key: "closed", label: "Paid and done" },
  { key: "rejected", label: "Rejected" },
] as const;
export type FinanceTab = (typeof FINANCE_TABS)[number]["key"];

const TAB_STATUSES: Readonly<Record<Exclude<FinanceTab, "all">, readonly FinanceStatus[]>> = {
  draft: ["draft", "revision"],
  desks: ["submitted", "reviewed"],
  authorized: ["authorized"],
  closed: ["paid", "done"],
  rejected: ["rejected"],
};
export const inTab = (tab: FinanceTab, status: FinanceStatus) =>
  tab === "all" || TAB_STATUSES[tab].includes(status);

/** The amount as typed in the form ("1500000.00"), from minor units. */
export const amountText = majorText;

export interface FinanceItem {
  id: string;
  version: number;
  category: FinanceCategory;
  categoryLabel: string;
  orgUnitId: string;
  unitName: string;
  title: string;
  description: string;
  amountMinor: number;
  currency: string;
  amount: string;
  date: string | null;
  account: string;
  fundSource: string;
  programId: string | null;
  status: FinanceStatus;
  statusLabel: string;
  requester: string;
  /** The viewer made it: they never act at its desks. */
  mine: boolean;
  documents: { path: string; name: string }[];
  treasurer: string | null;
  coordinator: string | null;
  revisionNote: string | null;
  rejectionNote: string | null;
  paid: { amount: string; by: string; proofPath: string; proofName: string } | null;
}

export function toFinanceItem(
  request: FinanceRequest,
  /** uid → person name. */
  names: ReadonlyMap<string, string>,
  unitName: string,
  viewerId: string,
): FinanceItem {
  const name = (uid: string) => names.get(uid) ?? uid;
  const desk = (stamp: FinanceRequest["treasurer"]) =>
    stamp ? `${name(stamp.uid)}${stamp.note ? ` — ${stamp.note}` : ""}` : null;
  return {
    id: request.id,
    version: request.version,
    category: request.category,
    categoryLabel: label(FINANCE_CATEGORY_LABELS, request.category),
    orgUnitId: request.orgUnitId,
    unitName,
    title: request.title,
    description: request.description,
    amountMinor: request.amountMinor,
    currency: request.currency,
    amount: formatMoney(request),
    date: request.date,
    account: request.account,
    fundSource: request.fundSource,
    programId: request.programId,
    status: request.status,
    statusLabel: label(FINANCE_STATUS_LABELS, request.status),
    requester: name(request.createdBy),
    mine: request.createdBy === viewerId,
    documents: request.documents.map((d) => ({ path: d.path, name: d.name })),
    treasurer: desk(request.treasurer),
    coordinator: desk(request.coordinator),
    revisionNote: request.revisionNote,
    rejectionNote: request.rejection?.note ?? null,
    paid: request.payment && {
      amount: formatMoney({ amountMinor: request.payment.amountMinor, currency: request.currency }),
      by: name(request.payment.uid),
      proofPath: request.payment.proof.path,
      proofName: request.payment.proof.name,
    },
  };
}

export interface CashSection {
  currency: string;
  opening: string;
  totalIn: string;
  totalOut: string;
  closing: string;
  rows: {
    id: string;
    date: string;
    category: string;
    description: string;
    amountIn: string;
    amountOut: string;
    balance: string;
    fromRequest: boolean;
  }[];
}

/** The report, formatted for the cash book page (one section per currency). */
export function toCashSections(report: readonly CurrencyReport[]): CashSection[] {
  return report.map((r) => {
    const money = (amountMinor: number) => formatMoney({ amountMinor, currency: r.currency });
    return {
      currency: r.currency,
      opening: money(r.opening),
      totalIn: money(r.totalIn),
      totalOut: money(r.totalOut),
      closing: money(r.closing),
      rows: r.rows.map(({ entry, balance }) => ({
        id: entry.id,
        date: entry.date,
        category: CASH_CATEGORY_LABELS[entry.category],
        description: entry.description,
        amountIn: entry.kind === "in" ? money(entry.amountMinor) : "",
        amountOut: entry.kind === "out" ? money(entry.amountMinor) : "",
        balance: money(balance),
        fromRequest: entry.source === "request",
      })),
    };
  });
}
