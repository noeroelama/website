"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import { certificateActions, certificateSending, letterActions } from "@/server/wiring";

// Thin server-action wrappers: every rule lives in src/server/letters.ts (createGuardedAction).
const done = <T extends { ok: boolean }>(result: T): T => {
  if (result.ok) revalidatePath("/letters", "layout");
  return result;
};

export async function saveLetterAction(input: unknown) {
  return done(await letterActions().save(getPrincipal, getAuditContext)(input));
}
export async function removeLetterAction(input: unknown) {
  return done(await letterActions().remove(getPrincipal, getAuditContext)(input));
}
export async function submitLetterAction(input: unknown) {
  return done(await letterActions().submit(getPrincipal, getAuditContext)(input));
}
export async function passLetterAction(input: unknown) {
  return done(await letterActions().pass(getPrincipal, getAuditContext)(input));
}
export async function returnLetterAction(input: unknown) {
  return done(await letterActions().returnToDraft(getPrincipal, getAuditContext)(input));
}
export async function signLetterAction(input: unknown) {
  return done(await letterActions().signSecretary(getPrincipal, getAuditContext)(input));
}
export async function signLetterAsCoordinatorAction(input: unknown) {
  return done(await letterActions().signCoordinator(getPrincipal, getAuditContext)(input));
}
export async function issueLetterAction(input: unknown) {
  return done(await letterActions().issue(getPrincipal, getAuditContext)(input));
}
export async function cancelLetterAction(input: unknown) {
  return done(await letterActions().cancel(getPrincipal, getAuditContext)(input));
}
export async function saveLetterTypeAction(input: unknown) {
  return done(await letterActions().saveType(getPrincipal, getAuditContext)(input));
}
export async function saveLetterheadAction(input: unknown) {
  return done(await letterActions().saveLetterhead(getPrincipal, getAuditContext)(input));
}
export async function placeLetterStampsAction(input: unknown) {
  return done(await letterActions().place(getPrincipal, getAuditContext)(input));
}
export async function issueLetterFileAction(input: unknown) {
  return done(await letterActions().issueFile(getPrincipal, getAuditContext)(input));
}
export async function sendCertificatesAction(input: unknown) {
  return done(await certificateSending().send(getPrincipal, getAuditContext)(input));
}
export async function retryCertificateSendsAction(input: unknown) {
  return done(await certificateSending().retryFailed(getPrincipal, getAuditContext)(input));
}
export async function addParticipantsAction(input: unknown) {
  return done(await certificateActions().add(getPrincipal, getAuditContext)(input));
}
export async function removeParticipantAction(input: unknown) {
  return done(await certificateActions().remove(getPrincipal, getAuditContext)(input));
}
