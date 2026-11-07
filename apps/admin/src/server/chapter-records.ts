import "server-only";
import { z } from "zod";
import type { SqlChapterRecordStore } from "@website/db/sql";
import {
  assertQuarterStarted,
  chapterSignal,
  ChapterOfficerSchema,
  ChapterReportInputSchema,
  REPORTS_FROM,
  type Chapter,
} from "@website/domain/organizations";
import { RuleViolationError } from "@website/domain/shared";
import { can } from "@website/permissions";
import { safeId } from "@website/security/validation";
import { createGuardedAction } from "./guarded-action";

export interface ChapterRecordDeps {
  readonly records: Pick<SqlChapterRecordStore, "saveOfficers" | "submitReport" | "reportedSince">;
  readonly chapter: (id: string) => Promise<Chapter | null>;
  readonly now: () => Date;
}

/**
 * Chapter officers (H1), quarterly reports (H3) and the risk signal (H2). A chapter admin
 * (organizations.edit for that chapter) acts for its own chapter; the secretariat/Sekjen (global)
 * for any, and their report is marked `filledByCentre`.
 */
export function createChapterRecords(deps: ChapterRecordDeps) {
  const today = () => deps.now().toISOString().slice(0, 10);
  const live = async (id: string) => {
    const chapter = await deps.chapter(id);
    if (!chapter || chapter.deletedAt) throw new RuleViolationError("This chapter does not exist.");
    return chapter;
  };

  const saveOfficers = createGuardedAction({
    permission: "organizations.edit",
    input: z
      .object({ chapterId: safeId, officers: z.array(ChapterOfficerSchema).max(20) })
      .strict(),
    resource: ({ chapterId }) => ({ chapterId }),
    handler: async ({ chapterId, officers }, _principal, audit) => {
      const chapter = await live(chapterId);
      await deps.records.saveOfficers(chapterId, officers, (before) =>
        audit({
          module: "organizations",
          action: "UPDATE",
          resourceType: "chapterOfficers",
          resourceId: chapterId,
          title: chapter.name,
          before: { officers: before.map((o) => ({ ...o })) },
          after: { officers: officers.map((o) => ({ ...o })) },
          versionBefore: null,
          versionAfter: null,
          revertible: false,
        }),
      );
      return { chapterId };
    },
  });

  const submitReport = createGuardedAction({
    permission: "organizations.edit",
    input: ChapterReportInputSchema,
    resource: ({ chapterId }) => ({ chapterId }),
    handler: async (input, principal, audit) => {
      const chapter = await live(input.chapterId);
      assertQuarterStarted(input.quarter, today());
      const report = await deps.records.submitReport(
        {
          ...input,
          submittedBy: principal.userId,
          submittedAt: deps.now(),
          // Decided now, from the submitter's scope: a global holder reports on behalf.
          filledByCentre: can(principal, "organizations.edit"),
        },
        (id, before) =>
          audit({
            module: "organizations",
            action: before ? "UPDATE" : "CREATE",
            resourceType: "chapterReport",
            resourceId: id,
            title: `${chapter.name} ${input.quarter}`,
            before: before && {
              activeMembers: before.activeMembers,
              activities: [...before.activities],
              obstacles: before.obstacles,
            },
            after: {
              activeMembers: input.activeMembers,
              activities: [...input.activities],
              obstacles: input.obstacles,
            },
            versionBefore: null,
            versionAfter: null,
            revertible: false,
          }),
      );
      return { id: report.id, filledByCentre: report.filledByCentre };
    },
  });

  /** The H2 signal of each chapter (inactive ones: null). */
  async function signals(chapters: readonly Chapter[]) {
    const reported = await deps.records.reportedSince(REPORTS_FROM);
    return new Map(
      chapters.map((c) => [
        c.id,
        chapterSignal(c.active, reported.get(c.id) ?? new Set(), today()),
      ]),
    );
  }

  return { saveOfficers, submitReport, signals };
}
