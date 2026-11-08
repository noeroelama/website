"use server";

import { getAuditContext, getPrincipal } from "@/server/context";
import { linkActions } from "@/server/wiring";

export async function createLinkAction(input: unknown) {
  return linkActions().create(getPrincipal, getAuditContext)(input);
}
export async function setLinkArchivedAction(input: unknown) {
  return linkActions().setArchived(getPrincipal, getAuditContext)(input);
}
export async function renameLinkAction(input: unknown) {
  return linkActions().rename(getPrincipal, getAuditContext)(input);
}
export async function linkClicksAction(input: unknown) {
  return linkActions().clicks(getPrincipal, getAuditContext)(input);
}
