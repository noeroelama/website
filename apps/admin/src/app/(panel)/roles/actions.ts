"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { accountActions, exportLog, roleActions } from "@/server/wiring";

const done = <T extends { ok: boolean }>(result: T) => {
  if (result.ok) revalidatePath("/roles", "layout");
  return result;
};

export async function addPersonAction(input: unknown) {
  return done(await accountActions().addPerson(getPrincipal, getAuditContext)(input));
}

export async function cancelInviteAction(input: unknown) {
  return done(await accountActions().cancelInvite(getPrincipal, getAuditContext)(input));
}

export async function assignRoleAction(input: unknown) {
  return done(await accountActions().assignRole(getPrincipal, getAuditContext)(input));
}

export async function revokeRoleAction(input: unknown) {
  return done(await accountActions().revokeRole(getPrincipal, getAuditContext)(input));
}

export async function setStatusAction(input: unknown) {
  return done(await accountActions().setStatus(getPrincipal, getAuditContext)(input));
}

export async function findPeopleAction(input: unknown) {
  return accountActions().findPeople(getPrincipal, getAuditContext)(input);
}

export async function personDetailsAction(input: unknown) {
  return accountActions().personDetails(getPrincipal, getAuditContext)(input);
}

export async function saveRoleAction(input: unknown) {
  return done(await roleActions().saveRole(getPrincipal, getAuditContext)(input));
}

export async function deleteRoleAction(input: unknown) {
  return done(await roleActions().deleteRole(getPrincipal, getAuditContext)(input));
}

export async function logPeopleExportAction(input: unknown) {
  return exportLog().people(getPrincipal, getAuditContext)(input);
}
