import { randomUUID } from "node:crypto";
import type { AuditEvent } from "@website/audit";
import type { Holiday, HolidayInput } from "@website/domain/tasks";
import { safeId } from "@website/security/validation";
import { createSqlAuditWriter } from "./audit";
import type { Database } from "./store";

export function createSqlCalendarStore(db: Database) {
  const holidays = db.collection("holidays");
  const feeds = db.collection("calendarFeeds");
  const audit = createSqlAuditWriter(db);
  return {
    async listHolidays(): Promise<Holiday[]> {
      const snapshot = await holidays.get();
      return snapshot.docs
        .map((d) => ({ id: d.id, date: d.get("date") as string, name: d.get("name") as string }))
        .sort((a, b) => a.date.localeCompare(b.date));
    },
    async saveHoliday(
      id: string | null,
      input: HolidayInput | null,
      auditFor: (id: string) => AuditEvent,
    ): Promise<string> {
      const ref = holidays.doc(id === null ? randomUUID() : safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const log = await audit.begin(tx);
        if (input) tx.set(ref, { ...input });
        else tx.delete(ref);
        log.append(auditFor(ref.id));
        return ref.id;
      });
    },
    async feedVersion(uid: string): Promise<number> {
      return ((await feeds.doc(safeId.parse(uid)).get()).get("version") as number | undefined) ?? 1;
    },
    async revokeFeed(uid: string, now: Date): Promise<number> {
      const ref = feeds.doc(safeId.parse(uid));
      return db.runTransaction(async (tx) => {
        const version = (((await tx.get(ref)).get("version") as number | undefined) ?? 1) + 1;
        tx.set(ref, { version, revokedAt: now });
        return version;
      });
    },
  };
}

export type SqlCalendarStore = ReturnType<typeof createSqlCalendarStore>;
