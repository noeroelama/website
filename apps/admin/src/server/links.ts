import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ShortLinkAudit, SqlShortLinkStore } from "@website/db/sql";
import {
  asRuleViolation,
  createOnFirst,
  ShortLinkInputSchema,
  type Shortener,
  type ShortLink,
} from "@website/domain/links";
import { RuleViolationError } from "@website/domain/shared";
import { safeId, safeText } from "@website/security/validation";
import { createGuardedAction, type AuditBuilder } from "./guarded-action";

export interface LinkDeps {
  readonly shorteners: readonly Shortener[];
  readonly links: Pick<SqlShortLinkStore, "get" | "write">;
  readonly logError: (message: string, fields: Record<string, unknown>) => void;
  readonly now: () => Date;
}

const version = z.number().int().min(1);
const Ref = z.object({ id: safeId, version }).strict();

const linkAudit =
  (audit: AuditBuilder, action: "CREATE" | "UPDATE"): ShortLinkAudit =>
  (before, after, current, next) =>
    audit({
      module: "tools",
      action,
      resourceType: "shortLink",
      resourceId: next.id,
      title: next.shortUrl,
      before,
      after,
      versionBefore: current?.version ?? null,
      versionAfter: next.version,
      revertible: false,
    });

export const linkRow = (l: ShortLink) => ({
  id: l.id,
  version: l.version,
  provider: l.provider,
  title: l.title,
  original: l.longUrl,
  slug: l.slug,
  shortUrl: l.shortUrl,
  archived: l.archivedAt !== null,
  createdAt: l.createdAt.toISOString().slice(0, 10),
});

export function createLinkActions(deps: LinkDeps) {
  const shortenerOf = (link: ShortLink) => {
    const shortener = deps.shorteners.find((s) => s.provider === link.provider);
    if (!shortener) throw new RuleViolationError("This provider is not set up any more.");
    return shortener;
  };
  const record = (
    created: Awaited<ReturnType<typeof createOnFirst>>,
    input: { longUrl: string; title: string },
    source: string,
    createdBy: string | null,
    audit: ShortLinkAudit,
  ) =>
    deps.links.write(
      null,
      null,
      () => ({
        ...created,
        longUrl: input.longUrl,
        title: input.title,
        source,
        createdBy,
        archivedAt: null,
        deletedAt: null,
      }),
      audit,
      deps.now(),
    );

  const create = createGuardedAction({
    permission: "tools.edit",
    input: ShortLinkInputSchema,
    handler: async (input, principal, audit) => {
      const created = await createOnFirst(deps.shorteners, input).catch(asRuleViolation);
      const saved = await record(
        created,
        input,
        "tools",
        principal.userId,
        linkAudit(audit, "CREATE"),
      );
      return linkRow(saved);
    },
  });

  const setArchived = createGuardedAction({
    permission: "tools.edit",
    input: Ref.extend({ archived: z.boolean() }).strict(),
    handler: async ({ id, version: v, archived }, _principal, audit) => {
      const link = await deps.links.get(id);
      if (!link) throw new RuleViolationError("This link does not exist.");
      const shortener = shortenerOf(link);
      await (archived ? shortener.archive(link.ref) : shortener.restore(link.ref)).catch(
        asRuleViolation,
      );
      const now = deps.now();
      const saved = await deps.links.write(
        id,
        v,
        (current) => ({ ...(current as ShortLink), archivedAt: archived ? now : null }),
        linkAudit(audit, "UPDATE"),
        now,
      );
      return linkRow(saved);
    },
  });

  const rename = createGuardedAction({
    permission: "tools.edit",
    input: Ref.extend({ title: safeText(200, { allowEmpty: true }) }).strict(),
    handler: async ({ id, version: v, title }, _principal, audit) => {
      const saved = await deps.links.write(
        id,
        v,
        (current) => ({ ...(current as ShortLink), title }),
        linkAudit(audit, "UPDATE"),
        deps.now(),
      );
      return linkRow(saved);
    },
  });

  const clicks = createGuardedAction({
    permission: "tools.read",
    input: z.object({ id: safeId }).strict(),
    handler: async ({ id }) => {
      const link = await deps.links.get(id);
      if (!link) throw new RuleViolationError("This link does not exist.");
      return { clicks: await shortenerOf(link).clicks(link.ref).catch(asRuleViolation) };
    },
  });

  async function shorten(longUrl: string, title: string, source: string): Promise<string> {
    try {
      const input = { longUrl, title, slug: null };
      const created = await createOnFirst(deps.shorteners, input);
      await record(created, input, source, null, (before, after, _current, next) => ({
        id: randomUUID(),
        occurredAt: deps.now(),
        actor: { type: "system", id: source },
        operationId: randomUUID(),
        module: "tools",
        action: "CREATE",
        resourceType: "shortLink",
        resourceId: next.id,
        title: next.shortUrl,
        before,
        after,
        versionBefore: null,
        versionAfter: next.version,
        revertible: false,
        revertOf: null,
        request: { requestId: randomUUID() },
        prevHash: null,
        hash: null,
      }));
      return created.shortUrl;
    } catch (error) {
      deps.logError("short link failed", { source, error: String(error) });
      return longUrl;
    }
  }

  return { create, setArchived, rename, clicks, shorten };
}
