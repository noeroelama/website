"use server";

import { submitPublicForm } from "@/server/forms-wiring";

export async function submitFormAction(input: unknown) {
  return submitPublicForm()(input);
}
