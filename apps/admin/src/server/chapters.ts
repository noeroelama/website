import "server-only";
import { z } from "zod";
import type { SqlChapterStore } from "@website/db/sql";
import { slugify } from "@website/domain/content";
import { ChapterInputSchema, type Chapter } from "@website/domain/organizations";
import { RuleViolationError } from "@website/domain/shared";
import { can } from "@website/permissions";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface ChapterDeps {
  readonly chapters: Pick<SqlChapterStore, "write">;
  readonly now: () => Date;
}

const SaveInput = ChapterInputSchema.extend({
  id: safeId.optional(),
  version: z.number().int().min(1).nullable(),
}).strict();

const BOARD_FIELDS = [
  "name",
  "countryCode",
  "region",
  "mapNo",
  "timezone",
  "logo",
  "latitude",
  "longitude",
  "slug",
  "memberCount",
  "conditions",
  "risk",
] as const satisfies readonly (keyof Chapter)[];

const chapterAudit =
  (audit: AuditBuilder, action: "CREATE" | "UPDATE" | "DELETE", revertible = true) =>
  (
    before: Parameters<AuditBuilder>[0]["before"],
    after: Parameters<AuditBuilder>[0]["after"],
    current: Chapter | null,
    next: Chapter,
  ) =>
    audit({
      module: "organizations",
      action,
      resourceType: "chapter",
      resourceId: next.id,
      title: next.name,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible,
    });

export function createChapterActions(deps: ChapterDeps) {
  const save = createGuardedAction({
    permission: "organizations.edit",
    input: SaveInput,
    resource: (input) => (input.id ? { chapterId: input.id } : {}),
    handler: async ({ id, version, slug: typedSlug, ...input }, principal, audit) => {
      const contactOnly = !can(principal, "organizations.edit");
      let revertible = true;
      const saved = await deps.chapters.write(
        id ?? null,
        version,
        (current) => {
          const slug = typedSlug || current?.slug || slugify(input.name);
          if (!slug) throw new RuleViolationError("Use letters or numbers in the name or URL.");
          if (current) revertible = current.slug === slug;
          const next = { ...input, slug, active: current?.active ?? true, deletedAt: null };
          const before = current as Chapter;
          const changed = (key: (typeof BOARD_FIELDS)[number]) =>
            JSON.stringify(next[key]) !== JSON.stringify(before[key]);
          if (contactOnly && BOARD_FIELDS.some(changed)) {
            throw new RuleViolationError(
              "Only the contact details of your chapter can be changed here.",
            );
          }
          return next;
        },
        (before, after, current, next) =>
          chapterAudit(audit, current ? "UPDATE" : "CREATE", revertible)(
            before,
            after,
            current,
            next,
          ),
        deps.now(),
      );
      return { id: saved.id, slug: saved.slug, version: saved.version };
    },
  });

  const setActive = createGuardedAction({
    permission: "organizations.edit",
    input: z.object({ id: safeId, version: z.number().int().min(1), active: z.boolean() }).strict(),
    handler: async ({ id, version, active }, _principal, audit) => {
      const saved = await deps.chapters.write(
        id,
        version,
        (current) => ({ ...(current as Chapter), active }),
        chapterAudit(audit, "UPDATE"),
        deps.now(),
      );
      return { version: saved.version };
    },
  });

  const remove = createGuardedAction({
    permission: "organizations.edit",
    input: z.object({ id: safeId, version: z.number().int().min(1) }).strict(),
    handler: async ({ id, version }, _principal, audit) => {
      const now = deps.now();
      const saved = await deps.chapters.write(
        id,
        version,
        (current) => ({ ...(current as Chapter), deletedAt: now }),
        chapterAudit(audit, "DELETE"),
        now,
      );
      return { version: saved.version };
    },
  });

  return { save, setActive, remove };
}
