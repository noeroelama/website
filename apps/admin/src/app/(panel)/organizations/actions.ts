"use server";

import { revalidatePath } from "next/cache";
import { getAuditContext, getPrincipal } from "@/server/context";
import {
  appointmentActions,
  chapterActions,
  chapterRecords,
  orgUnitActions,
  periodActions,
  universityActions,
} from "@/server/wiring";

export async function saveChapterAction(input: unknown) {
  const result = await chapterActions().save(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations", "layout");
  return result;
}

export async function setChapterActiveAction(input: unknown) {
  const result = await chapterActions().setActive(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations", "layout");
  return result;
}

export async function deleteChapterAction(input: unknown) {
  const result = await chapterActions().remove(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations", "layout");
  return result;
}

export async function savePeriodAction(input: unknown) {
  const result = await periodActions().save(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations", "layout");
  return result;
}

export async function activatePeriodAction(input: unknown) {
  const result = await periodActions().activate(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations", "layout");
  return result;
}

export async function deletePeriodAction(input: unknown) {
  const result = await periodActions().remove(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations", "layout");
  return result;
}

export async function saveOrgUnitAction(input: unknown) {
  const result = await orgUnitActions().save(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations", "layout");
  return result;
}

export async function moveOrgUnitAction(input: unknown) {
  const result = await orgUnitActions().move(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations", "layout");
  return result;
}

export async function deleteOrgUnitAction(input: unknown) {
  const result = await orgUnitActions().remove(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations", "layout");
  return result;
}

export async function appointAction(input: unknown) {
  const result = await appointmentActions().appoint(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations", "layout");
  return result;
}

export async function endAppointmentAction(input: unknown) {
  const result = await appointmentActions().end(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations", "layout");
  return result;
}

export async function saveAppointmentRolesAction(input: unknown) {
  const result = await appointmentActions().saveRoleMap(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations", "layout");
  return result;
}

export async function saveChapterOfficersAction(input: unknown) {
  const result = await chapterRecords().saveOfficers(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations", "layout");
  return result;
}

export async function submitChapterReportAction(input: unknown) {
  const result = await chapterRecords().submitReport(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations", "layout");
  return result;
}

export async function reviewUniversityAction(input: unknown) {
  const result = await universityActions().review(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations");
  return result;
}

export async function addUniversityAction(input: unknown) {
  const result = await universityActions().add(getPrincipal, getAuditContext)(input);
  if (result.ok) revalidatePath("/organizations");
  return result;
}
