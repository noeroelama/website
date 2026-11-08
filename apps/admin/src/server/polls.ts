import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SqlSurveyStore } from "@website/db/sql";
import {
  deliveryDecision,
  POLL_QUESTION,
  STAR_OPTIONS,
  starsOf,
  type Contact,
  type MessagingMode,
  type SurveySource,
} from "@website/domain/messaging";
import { readBodyLimited } from "@website/security";
import type { wahaPoll } from "./whatsapp";

export interface PollDeps {
  readonly surveys: Pick<SqlSurveyStore, "claim" | "setPollMessage" | "vote">;
  readonly contacts: (uids: readonly string[]) => Promise<Map<string, Contact>>;
  readonly sendPoll: ReturnType<typeof wahaPoll>;
  readonly delivery: { mode: MessagingMode; appEnv: string; testRecipients: readonly string[] };
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
  readonly now: () => Date;
}

export function createPolls(deps: PollDeps) {
  return {
    async ask(uids: readonly string[], source: SurveySource, sourceId: string): Promise<number> {
      let sent = 0;
      try {
        const contacts = await deps.contacts(uids);
        for (const uid of uids) {
          const phone = contacts.get(uid)?.phone;
          if (!phone) continue;
          const decision = deliveryDecision({ ...deps.delivery, recipient: phone });
          if (decision !== "send") continue;
          const survey = await deps.surveys.claim(source, sourceId, uid, STAR_OPTIONS, deps.now());
          if (!survey) continue;
          const result = await deps.sendPoll(phone, POLL_QUESTION, Object.keys(survey.options));
          if (!result.ok) {
            deps.logError("poll failed", { source, sourceId, error: result.error });
            continue;
          }
          await deps.surveys.setPollMessage(survey.id, result.messageId);
          sent += 1;
        }
      } catch (error) {
        deps.logError("poll failed", { source, sourceId, error: String(error) });
      }
      return sent;
    },
  };
}

export type Polls = ReturnType<typeof createPolls>;

const MAX_BODY = 64 * 1024;
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function createWahaWebhookRoute(deps: {
  readonly secret: string | undefined;
  readonly record: (provider: string, eventId: string, now: Date) => Promise<boolean>;
  readonly surveys: Pick<SqlSurveyStore, "vote">;
  readonly now: () => Date;
}) {
  return async (request: Request): Promise<Response> => {
    const bytes = await readBodyLimited(request, MAX_BODY);
    if (!bytes) return reply({ error: "too_large" }, 413);
    const given = Buffer.from(request.headers.get("x-webhook-hmac") ?? "", "hex");
    const expected = createHmac("sha512", deps.secret ?? "")
      .update(bytes)
      .digest();
    if (!deps.secret || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return reply({ error: "unauthenticated" }, 401);
    }
    let body: {
      event?: unknown;
      payload?: { vote?: Record<string, unknown>; poll?: Record<string, unknown> };
    };
    try {
      body = JSON.parse(new TextDecoder().decode(bytes)) as typeof body;
    } catch {
      return reply({ error: "invalid_input" }, 400);
    }
    if (body.event !== "poll.vote") return reply({ ok: true });
    const voteId = body.payload?.vote?.["id"];
    const pollId = body.payload?.poll?.["id"];
    const selected = body.payload?.vote?.["selectedOptions"];
    if (typeof voteId !== "string" || typeof pollId !== "string" || !Array.isArray(selected)) {
      return reply({ error: "invalid_input" }, 400);
    }
    const now = deps.now();
    const eventId = createHash("sha256")
      .update(`${voteId}:${JSON.stringify(selected)}:${String(body.payload?.vote?.["timestamp"])}`)
      .digest("hex");
    if (!(await deps.record("waha", eventId, now))) return reply({ ok: true });
    const labels = selected.filter((s): s is string => typeof s === "string");
    await deps.surveys.vote(pollId, (survey) => starsOf(survey, labels), now);
    return reply({ ok: true });
  };
}
