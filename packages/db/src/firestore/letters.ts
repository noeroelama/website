import { randomInt } from "node:crypto";
import type { Firestore, Query, Transaction } from "firebase-admin/firestore";
import type { AuditEvent, Snapshot } from "@website/audit";
import {
  DEFAULT_LETTERHEAD,
  deskLabel,
  formatNumber,
  isEditable,
  letterCanonical,
  makeVerificationCode,
  normalizeLetterInput,
  type Desk,
  type DeskSignature,
  type Letter,
  type LetterArchive,
  type LetterInput,
  type Letterhead,
  type LetterStatus,
  type LetterType,
  type LetterTypeInput,
  type SignerSnapshot,
} from "@website/domain/documents";
import { orgUnitPath, type OrgUnit } from "@website/domain/organizations";
import { ConcurrencyConflictError, RuleViolationError } from "@website/domain/shared";
import { sha256Hex } from "@website/security";
import { safeId } from "@website/security/validation";
import { createFirestoreAuditWriter } from "./audit";
import { nextNumbers } from "./counters";
import { createSluggedStore, toDate } from "./slugged";

type Meta = "id" | "version" | "createdAt" | "updatedAt";
export type LetterTypeFields = Omit<LetterType, Meta>;
export type LetterFields = Omit<Letter, Meta>;

const toLetterType = (id: string, data: Record<string, unknown>): LetterType => ({
  id,
  name: data["name"] as string,
  code: data["code"] as string,
  description: data["description"] as string,
  numberFormat: data["numberFormat"] as string,
  numberPadding: data["numberPadding"] as number,
  requiresCoordinator: data["requiresCoordinator"] as boolean,
  requiresRecipient: data["requiresRecipient"] as boolean,
  contentPublic: data["contentPublic"] as boolean,
  active: data["active"] as boolean,
  sort: data["sort"] as number,
  version: data["version"] as number,
  createdAt: toDate(data["createdAt"]) as Date,
  updatedAt: toDate(data["updatedAt"]) as Date,
  deletedAt: toDate(data["deletedAt"]),
});

export function letterTypeSnapshot(t: LetterTypeFields): Snapshot {
  return {
    name: t.name,
    code: t.code,
    description: t.description,
    numberFormat: t.numberFormat,
    numberPadding: t.numberPadding,
    requiresCoordinator: t.requiresCoordinator,
    requiresRecipient: t.requiresRecipient,
    contentPublic: t.contentPublic,
    active: t.active,
    sort: t.sort,
  };
}

/**
 * `letterTypes/{id}` (master data across periods) with the code unique case-insensitively
 * (`letterTypeCodes/{code}`). Types are deactivated, never deleted: issued letters point to them.
 */
export function createFirestoreLetterTypeStore(db: Firestore) {
  const store = createSluggedStore<LetterType>(db, {
    collection: "letterTypes",
    slug: {
      collection: "letterTypeCodes",
      key: (t) => t.code.toLowerCase(),
      taken: "Another letter type already uses this code.",
    },
    fromDoc: toLetterType,
    snapshot: letterTypeSnapshot,
    fixed: () => ({}),
  });
  return {
    get: store.get,
    async list(): Promise<LetterType[]> {
      const snapshot = await store.docs.where("deletedAt", "==", null).get();
      return snapshot.docs
        .map((doc) => store.read(doc.id, doc.data()))
        .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
    },
    save(
      id: string | null,
      version: number | null,
      input: LetterTypeInput,
      auditFor: (
        before: Snapshot | null,
        after: Snapshot | null,
        current: LetterType | null,
        next: LetterType,
      ) => AuditEvent,
      now: Date,
    ) {
      return store.write(id, version, () => ({ ...input, deletedAt: null }), auditFor, now);
    },
  };
}

export type FirestoreLetterTypeStore = ReturnType<typeof createFirestoreLetterTypeStore>;

/** `settings/letters`: the letterhead (+ version), edited on the Letter types page. */
export function createFirestoreLetterSettingsStore(db: Firestore) {
  const ref = db.collection("settings").doc("letters");
  const audit = createFirestoreAuditWriter(db);
  const read = (data: Record<string, unknown> | undefined) => {
    if (!data) return { letterhead: DEFAULT_LETTERHEAD, version: null };
    const { version, ...letterhead } = data;
    return { letterhead: letterhead as Letterhead, version: version as number };
  };
  return {
    async get(): Promise<{ letterhead: Letterhead; version: number | null }> {
      return read((await ref.get()).data());
    },
    save(
      letterhead: Letterhead,
      expectedVersion: number | null,
      auditFor: (before: Snapshot, after: Snapshot, version: number) => AuditEvent,
    ): Promise<number> {
      return db.runTransaction(async (tx) => {
        const current = read((await tx.get(ref)).data());
        if (current.version !== expectedVersion) {
          throw new ConcurrencyConflictError("letter settings changed");
        }
        const version = (current.version ?? 0) + 1;
        const log = await audit.begin(tx);
        tx.set(ref, { ...letterhead, version });
        log.append(auditFor({ ...current.letterhead }, { ...letterhead }, version));
        return version;
      });
    },
  };
}

export type FirestoreLetterSettingsStore = ReturnType<typeof createFirestoreLetterSettingsStore>;

const desk = (value: unknown): DeskSignature | null => {
  const data = value as { uid: string; at: unknown } | null | undefined;
  return data ? { uid: data.uid, at: toDate(data.at) as Date } : null;
};

function toLetter(id: string, data: Record<string, unknown>): Letter {
  return {
    id,
    periodId: data["periodId"] as string,
    typeId: data["typeId"] as string,
    orgUnitId: data["orgUnitId"] as string,
    orgUnitPath: data["orgUnitPath"] as string[],
    subject: data["subject"] as string,
    body: data["body"] as string,
    recipient: data["recipient"] as string,
    place: data["place"] as string,
    attachmentNote: data["attachmentNote"] as string,
    letterDate: data["letterDate"] as string | null,
    status: data["status"] as LetterStatus,
    source: data["source"] as Letter["source"],
    createdBy: data["createdBy"] as string,
    reviewedBy: data["reviewedBy"] as string | null,
    reviewNote: data["reviewNote"] as string | null,
    secretary: desk(data["secretary"]),
    coordinator: desk(data["coordinator"]),
    number: data["number"] as number | null,
    numberFormatted: data["numberFormatted"] as string | null,
    verificationCode: data["verificationCode"] as string | null,
    issuedAt: toDate(data["issuedAt"]),
    cancelledAt: toDate(data["cancelledAt"]),
    cancelReason: data["cancelReason"] as string | null,
    contentDigest: data["contentDigest"] as string | null,
    signers: (data["signers"] as Array<Record<string, unknown>>).map((s) => ({
      ...(s as unknown as SignerSnapshot),
      at: toDate(s["at"]) as Date,
    })),
    letterhead: data["letterhead"] as Letterhead | null,
    archive: data["archive"] as LetterArchive | null,
    version: data["version"] as number,
    createdAt: toDate(data["createdAt"]) as Date,
    updatedAt: toDate(data["updatedAt"]) as Date,
    deletedAt: toDate(data["deletedAt"]),
  };
}

/** Audit snapshot: the workflow fields (the body only as its length: it can be long). */
export function letterSnapshot(l: LetterFields): Snapshot {
  return {
    typeId: l.typeId,
    orgUnitId: l.orgUnitId,
    subject: l.subject,
    bodyLength: l.body.length,
    recipient: l.recipient,
    place: l.place,
    attachmentNote: l.attachmentNote,
    letterDate: l.letterDate,
    status: l.status,
    reviewNote: l.reviewNote,
    secretary: l.secretary?.uid ?? null,
    coordinator: l.coordinator?.uid ?? null,
    numberFormatted: l.numberFormatted,
    verificationCode: l.verificationCode,
    cancelReason: l.cancelReason,
  };
}

/** Everything stored for a letter (the audit snapshot is only part of it). */
const stored = (l: LetterFields) => ({
  periodId: l.periodId,
  typeId: l.typeId,
  orgUnitId: l.orgUnitId,
  orgUnitPath: l.orgUnitPath,
  subject: l.subject,
  body: l.body,
  recipient: l.recipient,
  place: l.place,
  attachmentNote: l.attachmentNote,
  letterDate: l.letterDate,
  status: l.status,
  source: l.source,
  createdBy: l.createdBy,
  reviewedBy: l.reviewedBy,
  reviewNote: l.reviewNote,
  secretary: l.secretary,
  coordinator: l.coordinator,
  number: l.number,
  numberFormatted: l.numberFormatted,
  verificationCode: l.verificationCode,
  issuedAt: l.issuedAt,
  cancelledAt: l.cancelledAt,
  cancelReason: l.cancelReason,
  contentDigest: l.contentDigest,
  signers: l.signers,
  letterhead: l.letterhead,
  archive: l.archive,
});

export type LetterAudit = (
  before: Snapshot | null,
  after: Snapshot | null,
  current: Letter | null,
  next: Letter,
) => AuditEvent;

export interface LetterListQuery {
  readonly periodId: string;
  readonly status?: LetterStatus | undefined;
  /** From `scopedOrgUnitIds`: "all", or the units (with everything below them) the viewer covers. */
  readonly orgUnitIds: "all" | readonly string[];
  readonly cursor?: string | undefined;
  readonly limit: number;
}

/** At most 30 values in one `array-contains-any`. */
const MAX_SCOPE_UNITS = 30;

/**
 * `letters/{id}` (D1, D2): drafts and the desk workflow through the slugged-store transaction
 * (version check + audit), and `issue`, ONE transaction that numbers the letter
 * (`letterCounters/{periodId}_{typeId}`), reserves its verification code
 * (`verificationCodes/{code}`, one space shared with certificates) and freezes the content
 * digest and the signers.
 */
export function createFirestoreLetterStore(
  db: Firestore,
  /** Random index 0..n-1 for verification codes (injectable for tests). */
  random: (n: number) => number = randomInt,
) {
  const store = createSluggedStore<Letter>(db, {
    collection: "letters",
    slug: null,
    fromDoc: toLetter,
    snapshot: letterSnapshot,
    fixed: (l) => stored(l),
  });
  const audit = createFirestoreAuditWriter(db);
  const codes = db.collection("verificationCodes");

  const readType = async (tx: Transaction, typeId: string) => {
    const snapshot = await tx.get(db.collection("letterTypes").doc(safeId.parse(typeId)));
    if (!snapshot.exists) throw new RuleViolationError("This letter type does not exist.");
    return toLetterType(snapshot.id, snapshot.data() as Record<string, unknown>);
  };

  /** The issuing unit, which must belong to the letter's period. */
  const readUnit = async (tx: Transaction, unitId: string, periodId: string) => {
    const snapshot = await tx.get(db.collection("orgUnits").doc(safeId.parse(unitId)));
    const unit = snapshot.data() as Omit<OrgUnit, "id"> | undefined;
    if (!unit || unit.deletedAt || unit.periodId !== periodId) {
      throw new RuleViolationError("Choose a unit of this board period.");
    }
    return { ...unit, id: snapshot.id } as OrgUnit;
  };

  return {
    get: store.get,

    /** Newest first; a viewer with unit scopes sees only their units' letters. */
    async list(query: LetterListQuery): Promise<{ items: Letter[]; nextCursor: string | null }> {
      if (query.orgUnitIds !== "all" && query.orgUnitIds.length === 0) {
        return { items: [], nextCursor: null };
      }
      let q: Query = store.docs
        .where("periodId", "==", query.periodId)
        .where("deletedAt", "==", null);
      if (query.status) q = q.where("status", "==", query.status);
      if (query.orgUnitIds !== "all") {
        q = q.where(
          "orgUnitPath",
          "array-contains-any",
          query.orgUnitIds.slice(0, MAX_SCOPE_UNITS),
        );
      }
      q = q.orderBy("createdAt", "desc");
      if (query.cursor) q = q.startAfter(new Date(Number(query.cursor)));
      const snapshot = await q.limit(query.limit + 1).get();
      const items = snapshot.docs.slice(0, query.limit).map((d) => store.read(d.id, d.data()));
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          snapshot.docs.length > query.limit && last ? String(last.createdAt.getTime()) : null,
      };
    },

    /** New draft in the active period. */
    create(
      input: LetterInput,
      createdBy: string,
      auditFor: LetterAudit,
      now: Date,
    ): Promise<Letter> {
      return store.write(
        null,
        null,
        async (_current, tx) => {
          const active = await tx.get(db.collection("settings").doc("activePeriod"));
          const periodId = active.get("periodId") as string | undefined;
          if (!periodId) throw new RuleViolationError("Activate a board period first.");
          const type = await readType(tx, input.typeId);
          if (!type.active || type.deletedAt) {
            throw new RuleViolationError("This letter type is not in use.");
          }
          const unit = await readUnit(tx, input.orgUnitId, periodId);
          return {
            ...normalizeLetterInput(input, type),
            periodId,
            orgUnitPath: orgUnitPath(unit),
            status: "draft",
            source: "editor",
            createdBy,
            reviewedBy: null,
            reviewNote: null,
            secretary: null,
            coordinator: null,
            number: null,
            numberFormatted: null,
            verificationCode: null,
            issuedAt: null,
            cancelledAt: null,
            cancelReason: null,
            contentDigest: null,
            signers: [],
            letterhead: null,
            archive: null,
            deletedAt: null,
          };
        },
        auditFor,
        now,
      );
    },

    /** Edits the draft fields (draft or review only). */
    update(
      id: string,
      version: number,
      input: LetterInput,
      auditFor: LetterAudit,
      now: Date,
    ): Promise<Letter> {
      return store.write(
        id,
        version,
        async (current, tx) => {
          const letter = current as Letter;
          if (!isEditable(letter)) {
            throw new RuleViolationError("Only drafts and letters under review can be edited.");
          }
          const type = await readType(tx, input.typeId);
          const unit = await readUnit(tx, input.orgUnitId, letter.periodId);
          return {
            ...letter,
            ...normalizeLetterInput(input, type),
            orgUnitPath: orgUnitPath(unit),
          };
        },
        auditFor,
        now,
      );
    },

    /** A workflow step decided by a pure domain function (submit, pass, return, sign, cancel). */
    transition(
      id: string,
      version: number,
      step: (letter: Letter, type: LetterType) => Letter,
      auditFor: LetterAudit,
      now: Date,
    ): Promise<Letter> {
      return store.write(
        id,
        version,
        async (current, tx) => {
          const letter = current as Letter;
          return step(letter, await readType(tx, letter.typeId));
        },
        auditFor,
        now,
      );
    },

    /** Drafts only, softly. */
    remove(id: string, version: number, auditFor: LetterAudit, now: Date): Promise<Letter> {
      return store.write(
        id,
        version,
        (current) => {
          const letter = current as Letter;
          if (letter.status !== "draft")
            throw new RuleViolationError("Only drafts can be deleted.");
          return { ...letter, deletedAt: now };
        },
        auditFor,
        now,
      );
    },

    /**
     * approved → issued: number, verification code, frozen signers and digest, all in ONE
     * transaction (a failure leaves no number used and no audit entry).
     */
    issue(
      id: string,
      version: number,
      /** `settings/letters` as it is now: frozen on the letter. */
      letterhead: Letterhead,
      auditFor: LetterAudit,
      now: Date,
    ): Promise<Letter> {
      const ref = store.docs.doc(safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw new RuleViolationError("This item does not exist.");
        const letter = store.read(ref.id, snapshot.data());
        if (letter.version !== version)
          throw new ConcurrencyConflictError("letters version changed");
        if (letter.deletedAt) throw new RuleViolationError("This item is in the trash.");
        if (letter.status !== "approved") {
          throw new RuleViolationError(
            "The signing desks must approve the letter before it is issued.",
          );
        }
        if (letter.source !== "editor") {
          throw new RuleViolationError("Uploaded documents are numbered with “Take number”.");
        }
        const type = await readType(tx, letter.typeId);
        const unit = await readUnit(tx, letter.orgUnitId, letter.periodId);
        const period = await tx.get(db.collection("periods").doc(letter.periodId));
        const signed = (["coordinator", "secretary"] as const).filter((d) => letter[d] !== null);
        const signers: SignerSnapshot[] = [];
        for (const d of signed) {
          signers.push(
            await signerSnapshot(tx, d, letter, type, unit, period.get("name") as string | null),
          );
        }
        let code = makeVerificationCode(random);
        for (let tries = 1; (await tx.get(codes.doc(code))).exists; tries += 1) {
          if (tries >= 5) throw new Error("No free verification code.");
          code = makeVerificationCode(random);
        }
        const log = await audit.begin(tx);
        const { first } = await nextNumbers(
          db,
          tx,
          { collection: "letterCounters", id: `${letter.periodId}_${letter.typeId}` },
          1,
        );
        // Submitting required the date (missingFields).
        const letterDate = letter.letterDate as string;
        const numbered: Letter = {
          ...letter,
          letterDate,
          status: "issued",
          number: first,
          numberFormatted: formatNumber(type.numberFormat, {
            seq: first,
            padding: type.numberPadding,
            typeCode: type.code,
            unitCode: unit.code,
            activityCode: null,
            date: letterDate,
          }),
          verificationCode: code,
          issuedAt: now,
          signers,
          letterhead,
          version: letter.version + 1,
          updatedAt: now,
        };
        const next = {
          ...numbered,
          contentDigest: sha256Hex(new TextEncoder().encode(letterCanonical(numbered, type.code))),
        };
        tx.set(ref, {
          ...stored(next),
          version: next.version,
          createdAt: next.createdAt,
          updatedAt: now,
          deletedAt: null,
        });
        tx.create(codes.doc(code), { kind: "letter", letterId: ref.id, periodId: letter.periodId });
        log.append(auditFor(letterSnapshot(letter), letterSnapshot(next), letter, next));
        return next;
      });
    },

    /**
     * Records the archived PDF once (later calls keep the first): the archive is the letter as it
     * was issued, never replaced. Not a user change, so no new version and no audit entry.
     */
    setArchive(id: string, archive: LetterArchive): Promise<LetterArchive> {
      const ref = store.docs.doc(safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const current = snapshot.get("archive") as LetterArchive | null | undefined;
        if (current) return current;
        tx.update(ref, { archive });
        return archive;
      });
    },
  };

  /** The desk, the person's name and their seat in this period, frozen at issue. */
  async function signerSnapshot(
    tx: Transaction,
    d: Desk,
    letter: Letter,
    type: LetterType,
    unit: OrgUnit,
    period: string | null,
  ): Promise<SignerSnapshot> {
    const signature = letter[d] as DeskSignature;
    const [user, seats] = await Promise.all([
      tx.get(db.collection("users").doc(signature.uid)),
      tx.get(
        db
          .collection("appointments")
          .where("userId", "==", signature.uid)
          .where("periodId", "==", letter.periodId)
          .where("status", "==", "active")
          .limit(1),
      ),
    ]);
    const seat = seats.docs[0];
    return {
      name:
        (seat?.get("name") as string | undefined) ??
        (user.get("name") as string | null | undefined) ??
        (user.get("email") as string),
      desk: deskLabel(d, type, unit.name),
      position: (seat?.get("title") as string | undefined) ?? null,
      period,
      at: signature.at,
    };
  }
}

export type FirestoreLetterStore = ReturnType<typeof createFirestoreLetterStore>;
