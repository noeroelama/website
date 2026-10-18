import "server-only";
import { z } from "zod";
import type { Messenger } from "@website/domain/messaging";
import { RuleViolationError } from "@website/domain/shared";
import { safeId } from "@website/security/validation";
import { createGuardedAction } from "./guarded-action";

/** Admin Messages page: one more attempt for a failed message (`messages.edit`). */
export function createMessageActions(deps: { messenger: Pick<Messenger, "retry"> }) {
  const retry = createGuardedAction({
    permission: "messages.edit",
    input: z.object({ id: safeId }).strict(),
    handler: async ({ id }) => {
      const status = await deps.messenger.retry(id);
      if (status === null) throw new RuleViolationError("Only failed messages can be retried.");
      return { status };
    },
  });
  return { retry };
}
