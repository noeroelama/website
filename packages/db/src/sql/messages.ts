import { createHash } from "node:crypto";
import type { Database } from "./store";
import type { Contact, Message, MessageLogEntry, MessageLogStore } from "@website/domain/messaging";
import {
  can,
  isSystemRoleId,
  normalizePermissions,
  type PagePermission,
  type ResourceContext,
  type RoleDefinition,
} from "@website/permissions";
import { safeId } from "@website/security/validation";
import { toPrincipal } from "../users";
import { getDocumentsByIds } from "./batch";
import { createSqlRoleStore } from "./users";

/** Document id = sha256(key): keys may contain ":" and stay unique per message. */
export const messageId = (key: string) => createHash("sha256").update(key).digest("hex");

const toDate = (value: unknown): Date => (value as { toDate(): Date }).toDate();
const toEntry = (id: string, data: Record<string, unknown>): MessageLogEntry =>
  ({
    ...data,
    id,
    createdAt: toDate(data["createdAt"]),
    updatedAt: toDate(data["updatedAt"]),
  }) as MessageLogEntry;

/**
 * `messageLog/{sha256(key)}`: key, channel, to, subject, text, html, status, attempts,
 * providerId, lastError, createdAt, updatedAt. Claiming a key is a create-if-absent
 * transaction, so the same message is never sent twice.
 */
export function createSqlMessageLog(db: Database) {
  const collection = db.collection("messageLog");
  const store: MessageLogStore = {
    claim(key, message: Message, now) {
      const ref = collection.doc(messageId(key));
      return db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) return "duplicate";
        tx.create(ref, {
          ...message,
          key,
          status: "queued",
          attempts: 0,
          providerId: null,
          lastError: null,
          createdAt: now,
          updatedAt: now,
        });
        return "new";
      });
    },

    finish(key, { status, providerId, lastError, attempted }, now) {
      const ref = collection.doc(messageId(key));
      return db.runTransaction(async (tx) => {
        // Set to 0 by `claim`, which always runs first.
        const attempts = (await tx.get(ref)).get("attempts") as number;
        tx.update(ref, {
          status,
          providerId: providerId ?? null,
          lastError: lastError ?? null,
          attempts: attempted ? attempts + 1 : attempts,
          updatedAt: now,
        });
      });
    },

    claimRetry(id, now) {
      const ref = collection.doc(safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists || snapshot.get("status") !== "failed") return null;
        tx.update(ref, { status: "queued", updatedAt: now });
        return toEntry(id, snapshot.data() as Record<string, unknown>);
      });
    },
  };

  return {
    ...store,
    /** Admin Email page: failed messages, newest first. */
    /** Entries of these keys (missing keys are absent): progress views such as bulk sends. */
    async byKeys(keys: readonly string[]): Promise<Map<string, MessageLogEntry>> {
      const found = await getDocumentsByIds<Record<string, unknown>>(
        db,
        "messageLog",
        keys.map(messageId),
      );
      const entries = [...found].flatMap(([id, data]) => (data ? [toEntry(id, data)] : []));
      return new Map(entries.map((entry) => [entry.key, entry]));
    },

    async listFailed({ cursor, limit }: { cursor?: string | undefined; limit: number }) {
      let query = collection
        .where("status", "==", "failed")
        .orderBy("createdAt", "desc")
        .orderBy("key", "desc");
      if (cursor !== undefined) {
        const [time = 0, key = ""] = JSON.parse(cursor) as [number, string];
        query = query.startAfter(new Date(time), key);
      }
      const snapshot = await query.limit(limit + 1).get();
      const items = snapshot.docs
        .slice(0, limit)
        .map((doc) => toEntry(doc.id, doc.data() as Record<string, unknown>));
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          snapshot.docs.length > limit && last
            ? JSON.stringify([last.createdAt.getTime(), last.key])
            : null,
      };
    },
  };
}

export type SqlMessageLog = ReturnType<typeof createSqlMessageLog>;

/**
 * Who to notify (J1, J2), read by the system only to deliver a message: the account e-mail and
 * the profile's WhatsApp number (restricted personal data: never shown, never logged), and the
 * accounts whose custom roles hold a desk permission (superadmins are not desk holders).
 */
export function createSqlContactReader(db: Database) {
  const roles = createSqlRoleStore(db);
  return {
    async contacts(uids: readonly string[]): Promise<Map<string, Contact>> {
      const [users, profiles] = await Promise.all([
        getDocumentsByIds<Record<string, unknown>>(db, "users", uids),
        getDocumentsByIds<Record<string, unknown>>(db, "memberProfiles", uids),
      ]);
      const text = (value: unknown) => (typeof value === "string" && value ? value : null);
      return new Map(
        [...users].map(([uid, user]) => [
          uid,
          { email: text(user?.["email"]), phone: text(profiles.get(uid)?.["whatsappNumber"]) },
        ]),
      );
    },

    /** Active accounts that hold `permission` on `resource` through a custom role. */
    async holders(permission: PagePermission, resource: ResourceContext): Promise<string[]> {
      const holding = (await roles.list()).filter(
        (role) =>
          !isSystemRoleId(role.id) && normalizePermissions(role.permissions).includes(permission),
      );
      if (holding.length === 0) return [];
      const ids = holding.map((role) => role.id);
      // array-contains-any takes at most 30 values per query.
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
      const [period, ...snapshots] = await Promise.all([
        db.collection("settings").doc("activePeriod").get(),
        ...chunks.map((chunk) =>
          db.collection("users").where("roleIds", "array-contains-any", chunk).get(),
        ),
      ]);
      const periodId = period.get("periodId");
      const map = new Map<string, RoleDefinition>(holding.map((role) => [role.id, role]));
      const found = new Set<string>();
      for (const doc of snapshots.flatMap((snapshot) => snapshot.docs)) {
        const principal = toPrincipal(
          doc.id,
          doc.data(),
          map,
          typeof periodId === "string" ? periodId : null,
        );
        if (can(principal, permission, resource)) found.add(doc.id);
      }
      return [...found];
    },
  };
}

export type SqlContactReader = ReturnType<typeof createSqlContactReader>;
