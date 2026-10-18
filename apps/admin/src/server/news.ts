import "server-only";
import { z } from "zod";
import type { FirestoreContentStore } from "@website/db/firestore";
import {
  isPubliclyVisible,
  NewsInputSchema,
  publishState,
  slugify,
  type ContentItem,
} from "@website/domain/content";
import { RuleViolationError } from "@website/domain/shared";
import { can, type Principal } from "@website/permissions";
import { sanitizeRichText } from "@website/security/html";
import { safeId } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface NewsDeps {
  readonly content: Pick<FirestoreContentStore, "write">;
  readonly now: () => Date;
}

const SaveInput = NewsInputSchema.extend({
  id: safeId.optional(),
  version: z.number().int().min(1).nullable(),
  intent: z.enum(["draft", "publish"]),
}).strict();
const RefInput = z.object({ id: safeId, version: z.number().int().min(1) }).strict();

const PUBLISH_NEEDED =
  "You can save drafts; publishing needs the Publish permission on the Article page.";

/** Audit entry for one news change (module `articles`, resource `content`). */
const newsAudit =
  (
    audit: AuditBuilder,
    action: "CREATE" | "UPDATE" | "PUBLISH" | "UNPUBLISH" | "DELETE",
    revertible = true,
  ) =>
  (
    before: Parameters<AuditBuilder>[0]["before"],
    after: Parameters<AuditBuilder>[0]["after"],
    current: ContentItem | null,
    next: ContentItem,
  ) =>
    audit({
      module: "articles",
      action,
      resourceType: "content",
      resourceId: next.id,
      title: next.title,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible,
    });

/** Admin News (Article page) actions: save (draft / publish / schedule), publish toggle, trash. */
export function createNewsActions(deps: NewsDeps) {
  const save = createGuardedAction({
    permission: "articles.edit",
    input: SaveInput,
    handler: async (input, principal: Principal, audit) => {
      if (input.intent === "publish" && !can(principal, "articles.publish")) {
        throw new RuleViolationError(PUBLISH_NEEDED);
      }
      const slug = input.slug || slugify(input.title);
      if (!slug) throw new RuleViolationError("Use letters or numbers in the title or URL.");
      const now = deps.now();
      const { status, publishAt } = publishState(input.intent, input.publishAt, now);
      let action: "CREATE" | "UPDATE" | "PUBLISH" = "CREATE";
      let revertible = true;
      const saved = await deps.content.write(
        input.id ?? null,
        input.version,
        (current) => {
          if (current) {
            const wasPublic = isPubliclyVisible(current, now) || current.status === "scheduled";
            action = input.intent === "publish" && !wasPublic ? "PUBLISH" : "UPDATE";
            // A changed URL would leave the slug index behind on revert: never revertible.
            revertible = current.slug === slug;
          }
          return {
            kind: "news",
            slug,
            title: input.title,
            author: input.author,
            category: input.category,
            summary: input.summary,
            tags: input.tags,
            body: sanitizeRichText(input.body),
            featuredImage: input.featuredImage,
            status,
            publishAt,
            chapterId: current?.chapterId ?? null,
            deletedAt: null,
          };
        },
        (before, after, current, next) =>
          newsAudit(audit, action, revertible)(before, after, current, next),
        now,
      );
      return { id: saved.id, slug: saved.slug, version: saved.version, status: saved.status };
    },
  });

  const setPublished = createGuardedAction({
    permission: "articles.publish",
    input: RefInput.extend({ published: z.boolean() }).strict(),
    handler: async ({ id, version, published }, _principal, audit) => {
      const now = deps.now();
      const saved = await deps.content.write(
        id,
        version,
        (current) => ({
          ...(current as ContentItem),
          // Immediate: publishing shows it now; unpublishing turns it back into a draft.
          ...(published ? { status: "published", publishAt: now } : { status: "draft" }),
        }),
        newsAudit(audit, published ? "PUBLISH" : "UNPUBLISH"),
        now,
      );
      return { version: saved.version, status: saved.status };
    },
  });

  const remove = createGuardedAction({
    permission: "articles.edit",
    input: RefInput,
    handler: async ({ id, version }, _principal, audit) => {
      const now = deps.now();
      await deps.content.write(
        id,
        version,
        (current) => ({ ...(current as ContentItem), deletedAt: now }),
        newsAudit(audit, "DELETE"),
        now,
      );
      return { id };
    },
  });

  return { save, setPublished, remove };
}
