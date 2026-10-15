/** What a staff member sees after a server action fails (GuardedResult errors). */
export type ActionFailure = {
  readonly ok: false;
  readonly error:
    "unauthenticated" | "forbidden" | "invalid_input" | "conflict" | "refused" | "reauthenticate";
  readonly issues?: readonly string[];
  readonly fields?: Readonly<Record<string, string>>;
};

const MESSAGES: Record<ActionFailure["error"], string> = {
  unauthenticated: "Your session has ended. Sign in again.",
  forbidden: "Your role does not allow this.",
  invalid_input: "Check the form and try again.",
  conflict: "Someone else changed this in the meantime. Reload the page and try again.",
  refused: "This change is not allowed.",
  reauthenticate: "For your security, sign in again (within the last 15 minutes) and retry.",
};

export function actionMessage(failure: ActionFailure): string {
  const detail = failure.issues?.[0];
  if ((failure.error === "refused" || failure.error === "invalid_input") && detail) return detail;
  return MESSAGES[failure.error];
}
