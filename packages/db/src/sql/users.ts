import { createHash, randomUUID } from "node:crypto";
import type { Database, QueryDocumentSnapshot } from "./store";
import type { AuditEvent } from "@website/audit";
import { ConcurrencyConflictError, RuleViolationError } from "@website/domain/shared";
import {
  DEFAULT_ROLE_ASSIGNMENTS,
  isWebsiteRole,
  SYSTEM_ROLES,
  type RoleAssignment,
  type RoleDefinition,
} from "@website/permissions";
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
  type CustomRole,
  type Invite,
  type RoleReader,
  type SignInRecorder,
  type StoredRole,
  type UserDirectory,
  type UserSummary,
} from "../users";
import { createSqlAuditWriter } from "./audit";
import { getDocumentsByIds } from "./batch";
import { toDate } from "./slugged";

export const inviteId = (email: string): string =>
  createHash("sha256").update(email.trim().toLowerCase()).digest("hex");

const toInvite = (data: Record<string, unknown>): Invite => ({
  email: data["email"] as string,
  roleIds: data["roleIds"] as string[],
  status: data["status"] as Invite["status"],
  invitedBy: data["invitedBy"] as string,
  createdAt: toDate(data["createdAt"]),
  version: data["version"] as number,
});

export function createSqlUserStore(db: Database): SignInRecorder & UserDirectory {
  const roles = createSqlRoleStore(db);
  const auditLog = createSqlAuditWriter(db);
  return {
    async recordSignIn(
      { uid, email, name, emailVerified },
      now,
      twoSignInMethods = () => Promise.resolve(false),
    ) {
      const ref = db.collection("users").doc(safeId.parse(uid));
      const inviteRef =
        email && emailVerified ? db.collection("invites").doc(inviteId(email)) : null;
      const pending = inviteRef ? await inviteRef.get() : null;
      const invitedIds =
        pending?.exists && pending.get("status") === "pending"
          ? (pending.get("roleIds") as string[])
          : [];
      const invited =
        invitedIds.length > 0 ? await roles.getMany(invitedIds) : new Map<string, RoleDefinition>();
      const staffAllowed = [...invited.values()].some((r) => r.permissions.length > 0)
        ? await twoSignInMethods()
        : false;

      return db.runTransaction(async (tx) => {
        const [snapshot, invite] = await Promise.all([
          tx.get(ref),
          inviteRef && invitedIds.length > 0 ? tx.get(inviteRef) : null,
        ]);
        const before = snapshot.exists
          ? parseAssignments(snapshot.get("roleAssignments"))
          : [...DEFAULT_ROLE_ASSIGNMENTS];
        const ids =
          invite?.exists && invite.get("status") === "pending"
            ? (invite.get("roleIds") as string[])
            : [];
        const held = new Set(
          before
            .filter((a) => !a.revokedAt && !a.periodId && a.scope.type === "global")
            .map((a) => a.roleId),
        );
        const open = ids.filter((id) => invited.has(id) && !held.has(id));
        const applied = open.filter(
          (id) => staffAllowed || (invited.get(id) as RoleDefinition).permissions.length === 0,
        );
        const after: RoleAssignment[] = [
          ...before.filter((a) => applied.length === 0 || !isWebsiteRole(a)),
          ...applied.map((roleId) => ({
            roleId,
            scope: { type: "global" } as const,
            periodId: null,
            source: "manual" as const,
            revokedAt: null,
          })),
        ];
        const log = applied.length > 0 ? await auditLog.begin(tx) : null;
        const versionBefore = snapshot.exists ? (snapshot.get("version") as number) : 0;
        const version = snapshot.exists ? versionBefore + (applied.length > 0 ? 1 : 0) : 1;
        const profile = { email, name: name ?? null, lastSignInAt: now };
        const roleFields = {
          roleAssignments: plainAssignments(after),
          roleIds: roleIdsOf(after),
          version,
        };
        if (!snapshot.exists) {
          tx.set(ref, { ...profile, ...roleFields, uid, status: "active", createdAt: now });
        } else {
          tx.update(ref, applied.length > 0 ? { ...profile, ...roleFields } : profile);
        }
        if (inviteRef && ids.length > 0) {
          const waiting = open.filter((id) => !applied.includes(id));
          tx.update(inviteRef, {
            roleIds: waiting,
            status: waiting.length > 0 ? "pending" : "accepted",
            version: (invite?.get("version") as number) + 1,
            updatedAt: now,
          });
        }
        log?.append({
          id: randomUUID(),
          occurredAt: now,
          actor: { type: "system", id: "invite" },
          action: "UPDATE",
          module: "users",
          title: String(email),
          resourceType: "user",
          resourceId: uid,
          operationId: randomUUID(),
          before: accountSnapshot({ status: "active", roleAssignments: before }),
          after: accountSnapshot({ status: "active", roleAssignments: after }),
          versionBefore,
          versionAfter: version,
          revertible: false,
          revertOf: null,
          request: { requestId: randomUUID() },
          prevHash: null,
          hash: null,
        });
        return { roleIds: roleIdsOf(after) };
      });
    },

    async findPrincipalByUid(uid) {
      const [snapshot, period] = await db.getAll(
        db.collection("users").doc(safeId.parse(uid)),
        db.collection("settings").doc("activePeriod"),
      );
      if (!snapshot?.exists) return null;
      const data = snapshot.data() as Record<string, unknown>;
      const ids = customRoleIds(parseAssignments(data["roleAssignments"]));
      const periodId = period?.get("periodId");
      return toPrincipal(
        uid,
        data,
        await roles.getMany(ids),
        typeof periodId === "string" ? periodId : null,
      );
    },
  };
}

export function createSqlAccountStore(db: Database) {
  const users = db.collection("users");
  const invites = db.collection("invites");
  const audit = createSqlAuditWriter(db);
  return {
    async listRoleHolders(
      roleIds: readonly string[],
      chapterIds?: readonly string[],
    ): Promise<UserSummary[]> {
      let docs: QueryDocumentSnapshot[];
      if (chapterIds !== undefined) {
        if (chapterIds.length > 30) throw new Error("A list can filter by at most 30 chapters.");
        docs =
          chapterIds.length === 0
            ? []
            : (await users.where("chapterId", "in", [...chapterIds]).get()).docs;
      } else {
        const chunks: string[][] = [];
        for (let i = 0; i < roleIds.length; i += 30) chunks.push(roleIds.slice(i, i + 30));
        const snapshots = await Promise.all(
          chunks.map((chunk) => users.where("roleIds", "array-contains-any", chunk).get()),
        );
        docs = snapshots.flatMap((snapshot) => snapshot.docs);
      }
      const wanted = new Set(roleIds);
      const found = new Map<string, UserSummary>();
      for (const doc of docs) found.set(doc.id, toUserSummary(doc.id, doc.data()));
      return [...found.values()].filter((user) =>
        user.roleAssignments.some((a) => wanted.has(a.roleId) && !a.revokedAt),
      );
    },

    async searchByPrefix(text: string, limit: number): Promise<UserSummary[]> {
      const capitalized = text.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
      const prefix = (field: string, value: string) =>
        users.where(field, ">=", value).where(field, "<=", `${value}\uf8ff`).limit(limit).get();
      const snapshots = await Promise.all([
        prefix("email", text.toLowerCase()),
        ...[...new Set([text, capitalized])].map((value) => prefix("name", value)),
      ]);
      const found = new Map<string, UserSummary>();
      for (const doc of snapshots.flatMap((snapshot) => snapshot.docs)) {
        found.set(doc.id, toUserSummary(doc.id, doc.data()));
      }
      return [...found.values()].slice(0, limit);
    },

    async findByName(name: string): Promise<UserSummary[]> {
      const snapshot = await users.where("name", "==", name).limit(2).get();
      return snapshot.docs.map((doc) => toUserSummary(doc.id, doc.data()));
    },

    async listInvites(): Promise<Invite[]> {
      const snapshot = await invites.where("status", "==", "pending").get();
      return snapshot.docs.map((doc) => toInvite(doc.data()));
    },

    invite(
      email: string,
      roleId: string,
      invitedBy: string,
      auditFor: (change: AuditChange, action: "CREATE" | "UPDATE", id: string) => AuditEvent,
      now: Date,
    ): Promise<Invite> {
      const address = email.trim().toLowerCase();
      const id = inviteId(address);
      const ref = invites.doc(id);
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const current = snapshot.exists
          ? toInvite(snapshot.data() as Record<string, unknown>)
          : null;
        const pending = current?.status === "pending" ? current : null;
        if (pending?.roleIds.includes(roleId)) {
          throw new RuleViolationError("This e-mail is already invited with this role.");
        }
        const next: Invite = {
          email: address,
          roleIds: [roleId],
          status: "pending",
          invitedBy,
          createdAt: pending ? pending.createdAt : now,
          version: (current?.version ?? 0) + 1,
        };
        const log = await audit.begin(tx);
        tx.set(ref, { ...next, updatedAt: now });
        log.append(
          auditFor(
            {
              before: pending && { roleIds: [...pending.roleIds] },
              after: { roleIds: [...next.roleIds] },
              versionBefore: current?.version ?? null,
              versionAfter: next.version,
            },
            pending ? "UPDATE" : "CREATE",
            id,
          ),
        );
        return next;
      });
    },

    cancelInvite(
      email: string,
      auditFor: (change: AuditChange, id: string) => AuditEvent,
      now: Date,
    ): Promise<Invite> {
      const id = inviteId(email);
      const ref = invites.doc(id);
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const current = snapshot.exists
          ? toInvite(snapshot.data() as Record<string, unknown>)
          : null;
        if (current?.status !== "pending") {
          throw new RuleViolationError("There is no pending invite for this e-mail.");
        }
        const next: Invite = {
          ...current,
          roleIds: [],
          status: "cancelled",
          version: current.version + 1,
        };
        const log = await audit.begin(tx);
        tx.update(ref, { roleIds: [], status: "cancelled", version: next.version, updatedAt: now });
        log.append(
          auditFor(
            {
              before: { roleIds: [...current.roleIds] },
              after: null,
              versionBefore: current.version,
              versionAfter: next.version,
            },
            id,
          ),
        );
        return next;
      });
    },

    async getMany(uids: readonly string[]): Promise<Map<string, UserSummary>> {
      const ids = uids.filter((uid) => safeId.safeParse(uid).success);
      const docs =
        ids.length > 0
          ? await getDocumentsByIds<Record<string, unknown>>(db, "users", ids)
          : new Map<string, Record<string, unknown> | null>();
      const result = new Map<string, UserSummary>();
      for (const [uid, data] of docs) if (data) result.set(uid, toUserSummary(uid, data));
      return result;
    },

    async get(uid: string): Promise<UserSummary | null> {
      if (!safeId.safeParse(uid).success) return null;
      const snapshot = await users.doc(uid).get();
      return snapshot.exists
        ? toUserSummary(uid, snapshot.data() as Record<string, unknown>)
        : null;
    },

    async findByEmail(email: string): Promise<UserSummary | null> {
      const snapshot = await users.where("email", "==", email.trim().toLowerCase()).limit(1).get();
      const doc = snapshot.docs[0];
      return doc ? toUserSummary(doc.id, doc.data()) : null;
    },

    async countActiveSuperadmins(): Promise<number> {
      const snapshot = await users.where("roleIds", "array-contains", "superadmin").get();
      return snapshot.docs.filter((doc) =>
        isActiveSuperadmin(toUserSummary(doc.id, doc.data() as Record<string, unknown>)),
      ).length;
    },

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

export type SqlAccountStore = ReturnType<typeof createSqlAccountStore>;

const roleSnapshot = (role: CustomRole) => ({
  name: role.name,
  color: role.color,
  permissions: [...role.permissions],
});

export function createSqlRoleStore(db: Database) {
  const collection = db.collection("roles");
  const users = db.collection("users");
  const audit = createSqlAuditWriter(db);
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

    async countHolders(ids: readonly string[]): Promise<Map<string, number>> {
      const counts = await Promise.all(
        ids.map(async (id) => {
          const result = await users.where("roleIds", "array-contains", id).count().get();
          return [id, result.data().count] as const;
        }),
      );
      return new Map(counts);
    },

    save(
      role: CustomRole,
      expectedVersion: number | null,
      decide: (previous: StoredRole | null) => void,
      auditFor: AuditFactory,
      now: Date,
    ): Promise<StoredRole> {
      const ref = collection.doc(safeId.parse(role.id));
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        const previous = snapshot.exists ? stored(role.id, snapshot.data()) : null;
        if (expectedVersion !== null && previous?.version !== expectedVersion) {
          throw new ConcurrencyConflictError("roles version changed");
        }
        decide(previous);
        const next: StoredRole = { ...role, version: (previous?.version ?? 0) + 1 };
        const log = await audit.begin(tx);
        tx.set(ref, {
          ...roleSnapshot(next),
          version: next.version,
          createdAt: previous === null ? now : snapshot.get("createdAt"),
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

export type SqlRoleStore = ReturnType<typeof createSqlRoleStore>;
