import type { Firestore, Query } from "firebase-admin/firestore";
import type { AuditEvent } from "@website/audit";
import { ConcurrencyConflictError, RuleViolationError } from "@website/domain/shared";
import { DEFAULT_ROLE_ASSIGNMENTS, SYSTEM_ROLES, type RoleDefinition } from "@website/permissions";
import { safeId } from "@website/security/validation";
import {
  accountSnapshot,
  customRoleIds,
  isActiveSuperadmin,
  parseAssignments,
  parseCustomRole,
  plainAssignments,
  roleIdsOf,
  systemRole,
  toPrincipal,
  toUserSummary,
  type AccountChange,
  type AuditChange,
  type AuditFactory,
  type Page,
  type RoleReader,
  type SignInRecorder,
  type StoredRole,
  type UserDirectory,
  type UserListQuery,
  type UserSummary,
} from "../users";
import { createFirestoreAuditWriter } from "./audit";
import { getDocumentsByIds } from "./batch";

/**
 * `users/{uid}`: uid, email, name, status, roleAssignments[], roleIds[] (for queries), version,
 * createdAt, lastSignInAt. The record is created on the first sign-in with the default role
 * (`user`); later sign-ins only refresh lastSignInAt, email and name — never the roles.
 */
export function createFirestoreUserStore(db: Firestore): SignInRecorder & UserDirectory {
  const roles = createFirestoreRoleStore(db);
  return {
    recordSignIn({ uid, email, name }, now) {
      const ref = db.collection("users").doc(safeId.parse(uid));
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const profile = { email, name: name ?? null, lastSignInAt: now };
        if (snapshot.exists) {
          tx.update(ref, profile);
          return { roleIds: roleIdsOf(parseAssignments(snapshot.get("roleAssignments"))) };
        }
        tx.set(ref, {
          ...profile,
          uid,
          status: "active",
          roleAssignments: plainAssignments(DEFAULT_ROLE_ASSIGNMENTS),
          roleIds: roleIdsOf(DEFAULT_ROLE_ASSIGNMENTS),
          version: 1,
          createdAt: now,
        });
        return { roleIds: roleIdsOf(DEFAULT_ROLE_ASSIGNMENTS) };
      });
    },

    /**
     * The principal for a request: the user record and `settings/activePeriod` in one round
     * trip; assignments of other periods and revoked ones grant nothing.
     */
    async findPrincipalByUid(uid) {
      const [snapshot, period] = await db.getAll(
        db.collection("users").doc(safeId.parse(uid)),
        db.collection("settings").doc("activePeriod"),
      );
      if (!snapshot?.exists) return null;
      const data = snapshot.data() as Record<string, unknown>;
      const ids = customRoleIds(parseAssignments(data["roleAssignments"]));
      const periodId = period?.get("periodId") as unknown;
      return toPrincipal(
        uid,
        data,
        await roles.getMany(ids),
        typeof periodId === "string" ? periodId : null,
      );
    },
  };
}

/** Admin Users page: list, read and change accounts (roles, status) with an audit entry. */
export function createFirestoreAccountStore(db: Firestore) {
  const users = db.collection("users");
  const audit = createFirestoreAuditWriter(db);
  return {
    /** Newest e-mail order: email, then uid. Filters: one role and/or status. */
    async list({ roleId, status, cursor, limit }: UserListQuery): Promise<Page<UserSummary>> {
      let query: Query = users;
      if (roleId !== undefined) query = query.where("roleIds", "array-contains", roleId);
      if (status !== undefined) query = query.where("status", "==", status);
      query = query.orderBy("email").orderBy("uid");
      if (cursor !== undefined) {
        const [email = null, uid = ""] = JSON.parse(cursor) as [string | null, string];
        query = query.startAfter(email, uid);
      }
      const snapshot = await query.limit(limit + 1).get();
      const items = snapshot.docs
        .slice(0, limit)
        .map((doc) => toUserSummary(doc.id, doc.data() as Record<string, unknown>));
      const last = items.at(-1);
      return {
        items,
        nextCursor:
          snapshot.docs.length > limit && last ? JSON.stringify([last.email, last.uid]) : null,
      };
    },

    async get(uid: string): Promise<UserSummary | null> {
      if (!safeId.safeParse(uid).success) return null;
      const snapshot = await users.doc(uid).get();
      return snapshot.exists
        ? toUserSummary(uid, snapshot.data() as Record<string, unknown>)
        : null;
    },

    /** Active global superadmins (the last one must never lose the role or be deactivated). */
    async countActiveSuperadmins(): Promise<number> {
      const snapshot = await users.where("roleIds", "array-contains", "superadmin").get();
      return snapshot.docs.filter((doc) =>
        isActiveSuperadmin(toUserSummary(doc.id, doc.data() as Record<string, unknown>)),
      ).length;
    },

    /**
     * Changes roles and/or status in ONE transaction: reads the account and every superadmin,
     * lets `decide` refuse (throw) with fresh data, then writes the change + its audit entry.
     */
    change(
      uid: string,
      expectedVersion: number,
      decide: (current: UserSummary, activeSuperadminsAfter: number) => void,
      change: AccountChange,
      auditFor: (change: AuditChange, current: UserSummary) => AuditEvent,
    ): Promise<UserSummary> {
      const ref = users.doc(safeId.parse(uid));
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) throw new RuleViolationError("This account does not exist.");
        const current = toUserSummary(uid, snapshot.data() as Record<string, unknown>);
        if (current.version !== expectedVersion) {
          throw new ConcurrencyConflictError("users version changed");
        }
        const holders = await tx.get(users.where("roleIds", "array-contains", "superadmin"));
        const next: UserSummary = {
          ...current,
          ...(change.roleAssignmentsFrom
            ? { roleAssignments: change.roleAssignmentsFrom(current) }
            : {}),
          ...(change.status ? { status: change.status } : {}),
          version: current.version + 1,
        };
        const others = holders.docs
          .filter((doc) => doc.id !== uid)
          .map((doc) => toUserSummary(doc.id, doc.data() as Record<string, unknown>))
          .filter(isActiveSuperadmin).length;
        decide(current, others + (isActiveSuperadmin(next) ? 1 : 0));

        const log = await audit.begin(tx);
        tx.update(ref, {
          status: next.status,
          roleAssignments: plainAssignments(next.roleAssignments),
          roleIds: roleIdsOf(next.roleAssignments),
          version: next.version,
        });
        log.append(
          auditFor(
            {
              before: accountSnapshot(current),
              after: accountSnapshot(next),
              versionBefore: current.version,
              versionAfter: next.version,
            },
            current,
          ),
        );
        return next;
      });
    },
  };
}

export type FirestoreAccountStore = ReturnType<typeof createFirestoreAccountStore>;

const roleSnapshot = (role: RoleDefinition) => ({
  name: role.name,
  permissions: [...role.permissions],
});

/** `roles/{id}`: name, permissions[], version, createdAt, updatedAt, deletedAt (custom only). */
export function createFirestoreRoleStore(db: Firestore) {
  const collection = db.collection("roles");
  const users = db.collection("users");
  const audit = createFirestoreAuditWriter(db);
  const stored = (id: string, data: unknown): StoredRole | null => {
    const role = parseCustomRole(id, data);
    if (!role) return null;
    const version = (data as Record<string, unknown>)["version"];
    return { ...role, version: typeof version === "number" ? version : 0 };
  };

  const reader = {
    async list(): Promise<Array<RoleDefinition | StoredRole>> {
      const snapshot = await collection.get();
      const custom = snapshot.docs
        .map((doc) => stored(doc.id, doc.data()))
        .filter((role) => role !== null)
        .sort((a, b) => a.id.localeCompare(b.id));
      return [...Object.values(SYSTEM_ROLES), ...custom];
    },

    async get(id: string): Promise<RoleDefinition | StoredRole | null> {
      const builtIn = systemRole(id);
      if (builtIn) return builtIn;
      if (!safeId.safeParse(id).success) return null;
      const snapshot = await collection.doc(id).get();
      return snapshot.exists ? stored(id, snapshot.data()) : null;
    },

    async getMany(ids: readonly string[]): Promise<Map<string, RoleDefinition>> {
      const result = new Map<string, RoleDefinition>();
      const storedIds = ids.filter((id) => !systemRole(id) && safeId.safeParse(id).success);
      const docs =
        storedIds.length > 0 ? await getDocumentsByIds(db, "roles", storedIds) : new Map();
      for (const id of ids) {
        const role = systemRole(id) ?? parseCustomRole(id, docs.get(id));
        if (role) result.set(id, role);
      }
      return result;
    },
  };

  return {
    ...(reader satisfies RoleReader),

    /** Accounts holding each role (any status), one count query per role. */
    async countHolders(ids: readonly string[]): Promise<Map<string, number>> {
      const counts = await Promise.all(
        ids.map(async (id) => {
          const result = await users.where("roleIds", "array-contains", id).count().get();
          return [id, result.data().count] as const;
        }),
      );
      return new Map(counts);
    },

    /**
     * Creates (expectedVersion null) or updates a custom role. `decide` sees the stored role
     * (null when new) and throws to refuse; a deleted role id counts as new.
     */
    save(
      role: RoleDefinition,
      expectedVersion: number | null,
      decide: (previous: StoredRole | null) => void,
      auditFor: AuditFactory,
      now: Date,
    ): Promise<StoredRole> {
      const ref = collection.doc(safeId.parse(role.id));
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const previous = snapshot.exists ? stored(role.id, snapshot.data()) : null;
        // A create (null) that finds an existing role is for `decide` to refuse with a message.
        if (expectedVersion !== null && previous?.version !== expectedVersion) {
          throw new ConcurrencyConflictError("roles version changed");
        }
        decide(previous);
        const next: StoredRole = { ...role, version: (previous?.version ?? 0) + 1 };
        const log = await audit.begin(tx);
        tx.set(ref, {
          ...roleSnapshot(next),
          version: next.version,
          createdAt: previous === null ? now : (snapshot.get("createdAt") as unknown),
          updatedAt: now,
          deletedAt: null,
        });
        log.append(
          auditFor({
            before: previous && roleSnapshot(previous),
            after: roleSnapshot(next),
            versionBefore: previous?.version ?? null,
            versionAfter: next.version,
          }),
        );
        return next;
      });
    },

    /** Soft-deletes a custom role; `decide` also sees how many accounts still hold it. */
    remove(
      id: string,
      expectedVersion: number,
      decide: (previous: StoredRole, holders: number) => void,
      auditFor: AuditFactory,
      now: Date,
    ): Promise<void> {
      const ref = collection.doc(safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const previous = snapshot.exists ? stored(id, snapshot.data()) : null;
        if (previous === null || previous.version !== expectedVersion) {
          throw new ConcurrencyConflictError("roles version changed");
        }
        const holders = await tx.get(users.where("roleIds", "array-contains", id));
        decide(previous, holders.size);
        const log = await audit.begin(tx);
        tx.update(ref, { deletedAt: now, updatedAt: now, version: previous.version + 1 });
        log.append(
          auditFor({
            before: roleSnapshot(previous),
            after: null,
            versionBefore: previous.version,
            versionAfter: previous.version + 1,
          }),
        );
      });
    },
  };
}

export type FirestoreRoleStore = ReturnType<typeof createFirestoreRoleStore>;
