import { createHash } from "node:crypto";
import type { Database, Query, Transaction } from "./store";
import {
  canonicalJson,
  evaluateRevert,
  type AuditAction,
  type AuditAppender,
  type AuditEvent,
  type RevertRejection,
} from "@website/audit";
import { safeId } from "@website/security/validation";
import { getDocumentsByIds } from "./batch";

export function createSqlAuditWriter(db: Database) {
  const logs = db.collection("auditLogs");
  const head = db.collection("auditChain").doc("head");

  async function begin(tx: Transaction): Promise<AuditAppender> {
    const snapshot = await tx.get(head);
    const stored = snapshot.exists ? (snapshot.data() as { hash: string; seq: number }) : null;
    let prevHash = stored?.hash ?? null;
    let seq = stored?.seq ?? 0;
    return {
      append(event) {
        const hash = createHash("sha256")
          .update(`${prevHash ?? ""}${canonicalJson({ ...event, prevHash: null, hash: null })}`)
          .digest("hex");
        seq += 1;
        const entry = Object.fromEntries(
          Object.entries({ ...event, prevHash, hash, seq }).filter(([, v]) => v !== undefined),
        );
        tx.create(logs.doc(safeId.parse(event.id)), entry);
        tx.set(head, { hash, seq });
        prevHash = hash;
      },
    };
  }

  return {
    begin,
    appendAlone(event: AuditEvent): Promise<void> {
      return db.runTransaction(async (tx) => (await begin(tx)).append(event));
    },
  };
}

export type SqlAuditWriter = ReturnType<typeof createSqlAuditWriter>;

const toDate = (value: unknown): Date => (value as { toDate(): Date }).toDate();

function toEvent(data: Record<string, unknown>): AuditEvent {
  return { ...(data as unknown as AuditEvent), occurredAt: toDate(data["occurredAt"]) };
}

export interface AuditListQuery {
  readonly actorEmail?: string | undefined;
  readonly module?: string | undefined;
  readonly action?: AuditAction | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
  readonly cursor?: string | undefined;
  readonly limit: number;
}

export type RevertibleCollections = Readonly<Record<string, string>>;

export type RevertOutcome = "reverted" | "missing" | RevertRejection;

export function createSqlAuditStore(db: Database) {
  const logs = db.collection("auditLogs");
  const writer = createSqlAuditWriter(db);

  async function revertContext(entries: readonly AuditEvent[], collections: RevertibleCollections) {
    const ids = entries.map((e) => e.id);
    const reverted = new Set<string>();
    for (let i = 0; i < ids.length; i += 30) {
      const found = await logs.where("revertOf", "in", ids.slice(i, i + 30)).get();
      for (const doc of found.docs) reverted.add(doc.get("revertOf") as string);
    }
    const versions = new Map<string, number | null>();
    const byCollection = new Map<string, AuditEvent[]>();
    for (const entry of entries) {
      const collection = collections[entry.resourceType];
      if (collection)
        byCollection.set(collection, [...(byCollection.get(collection) ?? []), entry]);
    }
    for (const [collection, list] of byCollection) {
      const docs = await getDocumentsByIds<Record<string, unknown>>(
        db,
        collection,
        list.map((e) => e.resourceId),
      );
      for (const entry of list) {
        const version = docs.get(entry.resourceId)?.["version"];
        versions.set(entry.id, typeof version === "number" ? version : null);
      }
    }
    return { reverted, versions };
  }

  return {
    async list({ actorEmail, module, action, from, to, cursor, limit }: AuditListQuery) {
      let query: Query = logs;
      if (actorEmail !== undefined) query = query.where("actor.email", "==", actorEmail);
      if (module !== undefined) query = query.where("module", "==", module);
      if (action !== undefined) query = query.where("action", "==", action);
      if (from !== undefined) query = query.where("occurredAt", ">=", from);
      if (to !== undefined) query = query.where("occurredAt", "<=", to);
      query = query.orderBy("occurredAt", "desc").orderBy("seq", "desc");
      if (cursor !== undefined) {
        const [time = 0, seq = 0] = JSON.parse(cursor) as [number, number];
        query = query.startAfter(new Date(time), seq);
      }
      const snapshot = await query.limit(limit + 1).get();
      const docs = snapshot.docs.slice(0, limit);
      const last = docs.at(-1);
      return {
        items: docs.map((doc) => toEvent(doc.data() as Record<string, unknown>)),
        nextCursor:
          snapshot.docs.length > limit && last
            ? JSON.stringify([toDate(last.get("occurredAt")).getTime(), last.get("seq") as number])
            : null,
      };
    },

    revertContext,

    revert(
      id: string,
      collections: RevertibleCollections,
      now: Date,
      buildEvent: (original: AuditEvent, currentVersion: number) => AuditEvent,
    ): Promise<RevertOutcome> {
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(logs.doc(safeId.parse(id)));
        if (!snapshot.exists) return "missing";
        const event = toEvent(snapshot.data() as Record<string, unknown>);
        const [first] = (await tx.get(logs.where("revertOf", "==", id).limit(1))).docs;
        const collection = collections[event.resourceType];
        const record = collection
          ? await tx.get(db.collection(collection).doc(safeId.parse(event.resourceId)))
          : null;
        const version = record?.get("version");
        const currentVersion = typeof version === "number" ? version : null;
        const decision = evaluateRevert({
          event: collection ? event : { ...event, revertible: false },
          existingRevert: first ? toEvent(first.data()) : null,
          currentVersion,
          now,
        });
        if (!decision.allowed) return decision.reason;

        const log = await writer.begin(tx);
        const restore =
          event.before === null
            ? { deletedAt: now }
            : event.after === null
              ? { deletedAt: null }
              : event.before;
        tx.update(db.collection(collection as string).doc(event.resourceId), {
          ...restore,
          version: (currentVersion as number) + 1,
          updatedAt: now,
        });
        log.append(buildEvent(event, currentVersion as number));
        return "reverted";
      });
    },
  };
}

export type SqlAuditStore = ReturnType<typeof createSqlAuditStore>;
