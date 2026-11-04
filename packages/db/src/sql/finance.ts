import type { Database, Query, Transaction } from "./store";
import type { AuditEvent, Snapshot } from "@website/audit";
import {
  isEditable,
  type DeskStamp,
  type FinanceFile,
  type FinancePayment,
  type FinanceRequest,
  type FinanceRequestInput,
} from "@website/domain/finance";
import { orgUnitPath, type OrgUnit } from "@website/domain/organizations";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createSluggedStore, toDate } from "./slugged";

type Meta = "id" | "version" | "createdAt" | "updatedAt";
export type FinanceFields = Omit<FinanceRequest, Meta>;

const stamp = (value: unknown): DeskStamp | null => {
  if (!value) return null;
  const s = value as Record<string, unknown>;
  return { ...(s as unknown as DeskStamp), at: toDate(s["at"]) as Date };
};

function toFinanceRequest(id: string, data: Record<string, unknown>): FinanceRequest {
  const payment = data["payment"] as Record<string, unknown> | null;
  return {
    id,
    periodId: data["periodId"] as string,
    orgUnitId: data["orgUnitId"] as string,
    orgUnitPath: data["orgUnitPath"] as string[],
    category: data["category"] as FinanceRequest["category"],
    title: data["title"] as string,
    description: data["description"] as string,
    amountMinor: data["amountMinor"] as number,
    currency: data["currency"] as FinanceRequest["currency"],
    date: data["date"] as string | null,
    account: data["account"] as string,
    fundSource: data["fundSource"] as string,
    programId: data["programId"] as string | null,
    status: data["status"] as FinanceRequest["status"],
    createdBy: data["createdBy"] as string,
    documents: data["documents"] as FinanceFile[],
    submittedAt: toDate(data["submittedAt"]),
    treasurer: stamp(data["treasurer"]),
    coordinator: stamp(data["coordinator"]),
    revisionNote: data["revisionNote"] as string | null,
    revisionRound: data["revisionRound"] as number,
    rejection: stamp(data["rejection"]),
    payment: payment && {
      ...(payment as unknown as FinancePayment),
      at: toDate(payment["at"]) as Date,
    },
    doneAt: toDate(data["doneAt"]),
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

/** Audit snapshot: the request and its desks (files by name only). */
export function financeSnapshot(r: FinanceFields): Snapshot {
  return {
    category: r.category,
    orgUnitId: r.orgUnitId,
    title: r.title,
    description: r.description,
    amountMinor: r.amountMinor,
    currency: r.currency,
    date: r.date,
    account: r.account,
    fundSource: r.fundSource,
    programId: r.programId,
    status: r.status,
    documents: r.documents.map((d) => d.name),
    treasurer: r.treasurer?.uid ?? null,
    coordinator: r.coordinator?.uid ?? null,
    revisionNote: r.revisionNote,
    rejection: r.rejection?.note ?? null,
    paidAmountMinor: r.payment?.amountMinor ?? null,
    proof: r.payment?.proof.name ?? null,
  };
}

const stored = (r: FinanceFields) => ({
  periodId: r.periodId,
  orgUnitId: r.orgUnitId,
  orgUnitPath: r.orgUnitPath,
  category: r.category,
  title: r.title,
  description: r.description,
  amountMinor: r.amountMinor,
  currency: r.currency,
  date: r.date,
  account: r.account,
  fundSource: r.fundSource,
  programId: r.programId,
  status: r.status,
  createdBy: r.createdBy,
  documents: r.documents,
  submittedAt: r.submittedAt,
  treasurer: r.treasurer,
  coordinator: r.coordinator,
  revisionNote: r.revisionNote,
  revisionRound: r.revisionRound,
  rejection: r.rejection,
  payment: r.payment,
  doneAt: r.doneAt,
});

export type FinanceAudit = (
  before: Snapshot | null,
  after: Snapshot | null,
  current: FinanceRequest | null,
  next: FinanceRequest,
) => AuditEvent;

export interface FinanceListQuery {
  readonly periodId: string;
  /** From `scopedOrgUnitIds`: "all", or the units (with everything below them) the viewer covers. */
  readonly orgUnitIds: "all" | readonly string[];
  readonly limit: number;
}

/** array-contains-any takes at most 30 values. */
const MAX_SCOPE_UNITS = 30;

/**
 * `financeRequests/{id}` (I1): drafts and the desk workflow, each change one versioned write
 * with its audit entry (slugged-store transaction, no slug).
 */
export function createSqlFinanceStore(db: Database) {
  const store = createSluggedStore<FinanceRequest>(db, {
    collection: "financeRequests",
    slug: null,
    fromDoc: toFinanceRequest,
    snapshot: financeSnapshot,
    fixed: stored,
  });

  /** The requesting unit, which must belong to the request's period. */
  const readUnit = async (tx: Transaction, unitId: string, periodId: string) => {
    const snapshot = await tx.get(db.collection("orgUnits").doc(safeId.parse(unitId)));
    const unit = snapshot.data() as Omit<OrgUnit, "id"> | undefined;
    if (!unit || unit.deletedAt || unit.periodId !== periodId) {
      throw new RuleViolationError("Choose a unit of this board period.");
    }
    return { ...unit, id: snapshot.id } as OrgUnit;
  };

  const change = (
    id: string,
    version: number,
    step: (request: FinanceRequest) => FinanceRequest,
    auditFor: FinanceAudit,
    now: Date,
  ) => store.write(id, version, (current) => step(current as FinanceRequest), auditFor, now);

  const editable = (request: FinanceRequest) => {
    if (!isEditable(request)) {
      throw new RuleViolationError("Only drafts and returned requests can be changed.");
    }
    return request;
  };

  return {
    get: store.get,

    /** Newest first; a viewer with unit scopes sees only their units' requests. */
    async list(query: FinanceListQuery): Promise<FinanceRequest[]> {
      if (query.orgUnitIds !== "all" && query.orgUnitIds.length === 0) return [];
      let q: Query = store.docs
        .where("periodId", "==", query.periodId)
        .where("deletedAt", "==", null);
      if (query.orgUnitIds !== "all") {
        q = q.where(
          "orgUnitPath",
          "array-contains-any",
          query.orgUnitIds.slice(0, MAX_SCOPE_UNITS),
        );
      }
      const snapshot = await q.orderBy("createdAt", "desc").limit(query.limit).get();
      return snapshot.docs.map((d) => store.read(d.id, d.data()));
    },

    /** A new draft in the active period. */
    create(input: FinanceRequestInput, createdBy: string, auditFor: FinanceAudit, now: Date) {
      return store.write(
        null,
        null,
        async (_current, tx) => {
          const active = await tx.get(db.collection("settings").doc("activePeriod"));
          const periodId = active.get("periodId") as string | undefined;
          if (!periodId) throw new RuleViolationError("Activate a board period first.");
          const unit = await readUnit(tx, input.orgUnitId, periodId);
          return {
            ...input,
            periodId,
            orgUnitPath: orgUnitPath(unit),
            status: "draft",
            createdBy,
            documents: [],
            submittedAt: null,
            treasurer: null,
            coordinator: null,
            revisionNote: null,
            revisionRound: 0,
            rejection: null,
            payment: null,
            doneAt: null,
            deletedAt: null,
          };
        },
        auditFor,
        now,
      );
    },

    /** Edits the request fields (draft or revision only). */
    update(
      id: string,
      version: number,
      input: FinanceRequestInput,
      auditFor: FinanceAudit,
      now: Date,
    ) {
      return store.write(
        id,
        version,
        async (current, tx) => {
          const request = editable(current as FinanceRequest);
          const unit = await readUnit(tx, input.orgUnitId, request.periodId);
          return { ...request, ...input, orgUnitPath: orgUnitPath(unit) };
        },
        auditFor,
        now,
      );
    },

    /** Drafts and returned requests, softly. */
    remove(id: string, version: number, auditFor: FinanceAudit, now: Date) {
      return change(id, version, (r) => ({ ...editable(r), deletedAt: now }), auditFor, now);
    },

    /** A workflow step decided by a pure domain function. */
    change,
  };
}

export type SqlFinanceStore = ReturnType<typeof createSqlFinanceStore>;
