import "server-only";
import { z } from "zod";
import {
  DraftOutputSchema,
  type DraftRequest,
  type MinutesDrafter,
} from "@website/domain/meetings";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";

const DRAFT_TOOL = {
  name: "minutes_draft",
  description: "Meeting minutes drafted from a transcript.",
  input_schema: z.toJSONSchema(DraftOutputSchema),
};

const SYSTEM =
  "You draft meeting minutes for an Indonesian student association. Write in the language of " +
  "the transcript, factual and short, in the third person. Use ONLY what the transcript says: " +
  "no invented decisions, names or numbers. For each agenda item give the discussion and the " +
  "decisions; leave an item out when the transcript does not cover it. Action items: only " +
  "explicit follow-ups; picUid must be one of the participant ids given, or null; dueOn only " +
  "when a date is said (YYYY-MM-DD), else null.";

const ToolAnswer = z.object({
  content: z.array(
    z.object({ type: z.string(), name: z.string().optional(), input: z.unknown().optional() }),
  ),
});

export function createAnthropicDrafter(config: {
  apiKey: string;
  model: string;
  fetchImpl: typeof fetch;
}): MinutesDrafter {
  const { fetchImpl } = config;
  return {
    async draft(request: DraftRequest) {
      const response = await fetchImpl("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
        headers: {
          "content-type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 8000,
          system: SYSTEM,
          tools: [DRAFT_TOOL],
          tool_choice: { type: "tool", name: DRAFT_TOOL.name },
          messages: [
            {
              role: "user",
              content: JSON.stringify({
                meeting: request.title,
                agenda: request.agenda,
                participants: request.participants,
                transcript: request.transcript,
              }),
            },
          ],
        }),
      });
      if (!response.ok) throw new Error(`anthropic_${response.status}`);
      const answer = ToolAnswer.safeParse(await response.json());
      const call = answer.success
        ? answer.data.content.find((c) => c.type === "tool_use" && c.name === DRAFT_TOOL.name)
        : undefined;
      const draft = DraftOutputSchema.safeParse(call?.input);
      if (!draft.success) throw new Error("anthropic_invalid_answer");
      return draft.data;
    },
  };
}
