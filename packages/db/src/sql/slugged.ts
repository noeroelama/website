import { randomUUID } from "node:crypto";
import type { CollectionReference, Database, Transaction } from "./store";
import type { AuditEvent, Snapshot } from "@website/audit";
import {
  ConcurrencyConflictError,
  RuleViolationError,
  type EntityMeta,
} from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createSqlAuditWriter } from "./audit";

export const toDate = (value: unknown): Date | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return new Date(value);
  if (value instanceof Date) return value;
  return (value as { toDate(): Date }).toDate();
};

type Meta = "id" | "version" | "createdAt" | "updatedAt";

export interface SluggedConfig<T extends EntityMeta> {
  readonly collection: string;
  readonly slug: {
    readonly collection: string;
    readonly key: (item: Omit<T, Meta>) => string;
    readonly taken?: string;
  } | null;
  readonly fromDoc: (id: string, data: Record<string, unknown>) => T;
  readonly snapshot: (item: Omit<T, Meta>) => Snapshot;
  readonly fixed: (item: T) => Record<string, unknown>;
}

export function createSluggedStore<T extends EntityMeta>(db: Database, config: SluggedConfig<T>) {
  const docs = db.collection(config.collection);
  const audit = createSqlAuditWriter(db);
  const slugs = config.slug ? db.collection(config.slug.collection) : null;
  const slugRef = (key: string) => (slugs as CollectionReference).doc(safeId.parse(key));
  const read = (id: string, data: unknown) => config.fromDoc(id, data as Record<string, unknown>);
  const takenMessage =
    config.slug?.taken ?? "This URL is already used by another item. Choose another one.";

  return {
    docs,
    read,

    get: async (id: string): Promise<T | null> => {
      if (!safeId.safeParse(id).success) return null;
      const snapshot = await docs.doc(id).get();
      return snapshot.exists ? read(id, snapshot.data()) : null;
    },

    findBySlugKey: async (key: string): Promise<T | null> => {
      if (!safeId.safeParse(key).success) return null;
      const pointer = await slugRef(key).get();
      if (!pointer.exists) return null;
      const snapshot = await docs.doc(pointer.get("id") as string).get();
      if (!snapshot.exists) return null;
      const item = read(snapshot.id, snapshot.data());
      return item.deletedAt === null ? item : null;
    },

    write: (
      id: string | null,
      expectedVersion: number | null,
      build: (current: T | null, tx: Transaction) => Omit<T, Meta> | Promise<Omit<T, Meta>>,
      auditFor: (
        before: Snapshot | null,
        after: Snapshot | null,
        current: T | null,
        next: T,
      ) => AuditEvent,
      now: Date,
    ): Promise<T> => {
      const ref = docs.doc(id === null ? randomUUID() : safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const snapshot = id === null ? null : await tx.get(ref);
        if (id !== null && !snapshot?.exists)
          throw new RuleViolationError("This item does not exist.");
        const current = snapshot?.exists ? read(ref.id, snapshot.data()) : null;
        if ((current?.version ?? null) !== expectedVersion) {
          throw new ConcurrencyConflictError(`${config.collection} version changed`);
        }
        if (current?.deletedAt) throw new RuleViolationError("This item is in the trash.");
        const fields = await build(current, tx);
        const key = config.slug ? config.slug.key(fields) : null;
        const oldKey = current && config.slug ? config.slug.key(current) : null;
        if (key !== null && key !== oldKey) {
          const taken = await tx.get(slugRef(key));
          if (taken.exists && taken.get("id") !== ref.id) {
            throw new RuleViolationError(takenMessage);
          }
        }
        const next = {
          ...fields,
          id: ref.id,
          version: (current?.version ?? 0) + 1,
          createdAt: current?.createdAt ?? now,
          updatedAt: now,
        } as T;
        const log = await audit.begin(tx);
        tx.set(ref, {
          ...config.snapshot(next),
          ...config.fixed(next),
          version: next.version,
          createdAt: next.createdAt,
          updatedAt: now,
          deletedAt: next.deletedAt,
        });
        if (key !== null && key !== oldKey) {
          tx.set(slugRef(key), { id: ref.id });
          if (oldKey) tx.delete(slugRef(oldKey));
        }
        log.append(
          auditFor(
            current && config.snapshot(current),
            next.deletedAt ? null : config.snapshot(next),
            current,
            next,
          ),
        );
        return next;
      });
    },
  };
}
