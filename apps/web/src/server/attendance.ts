import "server-only";
import type { SqlMeetingStore } from "@website/db/sql";
import { markAttendance, normalizeCode } from "@website/domain/meetings";
import { RuleViolationError } from "@website/domain/shared";

export type AttendResult =
  | { ok: true; title: string }
  | { ok: false; error: "signin" | "invalid" | "not_participant" | "closed" };

export function createAttend(deps: {
  meetings: Pick<SqlMeetingStore, "findCode" | "attend">;
  now: () => Date;
}) {
  return async (uid: string | null, typed: string): Promise<AttendResult> => {
    if (!uid) return { ok: false, error: "signin" };
    const code = normalizeCode(typed);
    if (!code) return { ok: false, error: "invalid" };
    const now = deps.now();
    const meetingId = await deps.meetings.findCode(code, now);
    if (!meetingId) return { ok: false, error: "invalid" };
    try {
      const saved = await deps.meetings.attend(
        meetingId,
        (m) => markAttendance(m, uid, "code", now),
        now,
      );
      return { ok: true, title: saved.title };
    } catch (error) {
      if (!(error instanceof RuleViolationError)) throw error;
      return {
        ok: false,
        error: error.message.startsWith("You are not") ? "not_participant" : "closed",
      };
    }
  };
}
