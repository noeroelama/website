import type { Firestore } from "firebase-admin/firestore";
import { DEFAULT_ROLE_ASSIGNMENTS, SYSTEM_ROLES, type RoleDefinition } from "@website/permissions";
import { safeId } from "@website/security/validation";
import {
  customRoleIds,
  parseAssignments,
  parseCustomRole,
  systemRole,
  toPrincipal,
  type RoleReader,
  type SignInRecorder,
  type UserDirectory,
} from "../users";
import { getDocumentsByIds } from "./batch";

/**
 * `users/{uid}`: email, name, status, roleAssignments[], createdAt, lastSignInAt.
 * The record is created on the first sign-in with the default role (`user`); later sign-ins only
 * refresh lastSignInAt, email and name — never the roles.
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
        } else {
          tx.set(ref, {
            ...profile,
            status: "active",
            roleAssignments: DEFAULT_ROLE_ASSIGNMENTS.map((a) => ({ ...a, scope: { ...a.scope } })),
            createdAt: now,
          });
        }
      });
    },

    async findPrincipalByUid(uid) {
      const snapshot = await db.collection("users").doc(safeId.parse(uid)).get();
      if (!snapshot.exists) return null;
      const data = snapshot.data() as Record<string, unknown>;
      const ids = customRoleIds(parseAssignments(data["roleAssignments"]));
      return toPrincipal(uid, data, await roles.getMany(ids));
    },
  };
}

/** `roles/{id}`: name, permissions[], version, timestamps, deletedAt (custom roles only). */
export function createFirestoreRoleStore(db: Firestore): RoleReader {
  const collection = db.collection("roles");
  return {
    async list() {
      const snapshot = await collection.get();
      const custom = snapshot.docs
        .map((doc) => parseCustomRole(doc.id, doc.data()))
        .filter((role) => role !== null)
        .sort((a, b) => a.id.localeCompare(b.id));
      return [...Object.values(SYSTEM_ROLES), ...custom];
    },

    async get(id) {
      const builtIn = systemRole(id);
      if (builtIn) return builtIn;
      if (!safeId.safeParse(id).success) return null;
      const snapshot = await collection.doc(id).get();
      return snapshot.exists ? parseCustomRole(id, snapshot.data()) : null;
    },

    async getMany(ids) {
      const result = new Map<string, RoleDefinition>();
      const stored = ids.filter((id) => !systemRole(id) && safeId.safeParse(id).success);
      const docs = stored.length > 0 ? await getDocumentsByIds(db, "roles", stored) : new Map();
      for (const id of ids) {
        const role = systemRole(id) ?? parseCustomRole(id, docs.get(id));
        if (role) result.set(id, role);
      }
      return result;
    },
  };
}
