import type { AuditEvent } from "@website/audit";
import {
  chapterReportId,
  type ChapterOfficer,
  type ChapterReport,
  type Quarter,
} from "@website/domain/organizations";
import { safeId } from "@website/security/validation";
import { createSqlAuditWriter } from "./audit";
import { toDate } from "./slugged";
import type { Database } from "./store";

const toReport = (id: string, d: Record<string, unknown>): ChapterReport => ({
  id,
  chapterId: d["chapterId"] as string,
  quarter: d["quarter"] as string,
  activeMembers: d["activeMembers"] as number,
  activities: d["activities"] as string[],
  obstacles: d["obstacles"] as string,
  submittedBy: d["submittedBy"] as string,
  submittedAt: toDate(d["submittedAt"]) as Date,
  filledByCentre: d["filledByCentre"] as boolean,
});

export function createSqlChapterRecordStore(db: Database) {
  const officers = db.collection("chapterOfficers");
  const reports = db.collection("chapterReports");
  const audit = createSqlAuditWriter(db);
  return {
    async officers(chapterId: string): Promise<ChapterOfficer[]> {
      const doc = await officers.doc(safeId.parse(chapterId)).get();
      return (doc.get("officers") as ChapterOfficer[] | undefined) ?? [];
    },
    async saveOfficers(
      chapterId: string,
      list: readonly ChapterOfficer[],
      auditFor: (before: ChapterOfficer[]) => AuditEvent,
    ): Promise<void> {
      const ref = officers.doc(safeId.parse(chapterId));
      await db.runTransaction(async (tx) => {
        const before = ((await tx.get(ref)).get("officers") as ChapterOfficer[] | undefined) ?? [];
        const log = await audit.begin(tx);
        tx.set(ref, { officers: list.map((o) => ({ ...o })) });
        log.append(auditFor(before));
      });
    },
    async reportsOf(chapterId: string): Promise<ChapterReport[]> {
      const snapshot = await reports.where("chapterId", "==", chapterId).get();
      return snapshot.docs
        .map((d) => toReport(d.id, d.data()))
        .sort((a, b) => b.quarter.localeCompare(a.quarter));
    },
    async reportedSince(from: Quarter): Promise<Map<string, Set<Quarter>>> {
      const snapshot = await reports.where("quarter", ">=", from).get();
      const map = new Map<string, Set<Quarter>>();
      for (const d of snapshot.docs) {
        const r = toReport(d.id, d.data());
        map.set(r.chapterId, (map.get(r.chapterId) ?? new Set()).add(r.quarter));
      }
      return map;
    },
    async submitReport(
      report: Omit<ChapterReport, "id">,
      auditFor: (id: string, before: ChapterReport | null) => AuditEvent,
    ): Promise<ChapterReport> {
      const id = chapterReportId(report.chapterId, report.quarter);
      const ref = reports.doc(safeId.parse(id));
      return db.runTransaction(async (tx) => {
        const current = await tx.get(ref);
        const before = current.exists
          ? toReport(id, current.data() as Record<string, unknown>)
          : null;
        const log = await audit.begin(tx);
        tx.set(ref, { ...report, activities: [...report.activities] });
        log.append(auditFor(id, before));
        return { ...report, id };
      });
    },
  };
}

export type SqlChapterRecordStore = ReturnType<typeof createSqlChapterRecordStore>;
