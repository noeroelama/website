import "server-only";
import { lazyEnv } from "@website/config/env";
import type { UserListQuery } from "@website/db";
import { createAccountActions } from "./accounts";
import { createRoleActions } from "./roles";
import { adminStores } from "./stores";

/** Users and Roles page actions with the real stores (server actions call these). */
export const accountActions = lazyEnv(() => createAccountActions(adminStores()));
export const roleActions = lazyEnv(() =>
  createRoleActions({ roles: adminStores().roles, now: () => new Date() }),
);

/** Reads for the Users and Roles pages. Callers check `users.read` / `roles.read` first. */
export const adminReads = {
  listUsers: (query: UserListQuery) => adminStores().accounts.list(query),
  getUser: (uid: string) => adminStores().accounts.get(uid),
  listRoles: () => adminStores().roles.list(),
  getRole: (id: string) => adminStores().roles.get(id),
  countHolders: (ids: readonly string[]) => adminStores().roles.countHolders(ids),
  signInMethods: async (uid: string) => {
    const { authAdmin, passkeys } = adminStores();
    const [methods, keys] = await Promise.all([
      authAdmin.signInMethods(uid),
      passkeys.listByUser(uid),
    ]);
    return { ...methods, passkeys: keys.length };
  },
};
