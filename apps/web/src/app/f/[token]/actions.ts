"use server";

import { submitPublicForm } from "@/server/forms-wiring";

// Thin wrapper: every rule lives in src/server/forms.ts and the form store (one transaction).
export async function submitFormAction(input: unknown) {
  return submitPublicForm()(input);
}
