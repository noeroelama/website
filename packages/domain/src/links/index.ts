import { z } from "zod";
import { safeText } from "@website/security/validation";
import { RuleViolationError, type EntityMeta } from "../shared";

/**
 * Short links (K1), ported from PPIDK `Tautan/*`: goppi.id is the PRIMARY provider, s.id the
 * fallback (X3). One port, two adapters (apps/admin/src/server/shorteners.ts). Links made by
 * the system (Zoom join URLs) use SILENT mode: any failure gives back the long URL. Links made
 * on the Tools page use INTERACTIVE mode: the reason is shown. Every link is kept in
 * `shortLinks/{provider}_{slug}`; "archive" is the providers' soft delete (the slug is not freed).
 */

export const SHORTENER_PROVIDERS = ["goppi", "sid"] as const;
export type ShortenerProvider = (typeof SHORTENER_PROVIDERS)[number];

export type ShortenerFailure = "slug_taken" | "invalid" | "unavailable" | "not_supported";

/** A provider failure with a reason the page can explain. */
export class ShortenerError extends Error {
  override readonly name = "ShortenerError";
  readonly reason: ShortenerFailure;
  constructor(reason: ShortenerFailure, detail = "") {
    super(`${reason}${detail ? `: ${detail}` : ""}`);
    this.reason = reason;
  }
}

export interface CreatedLink {
  /** The provider's handle for later calls (goppi: link id; s.id: the short code). */
  readonly ref: string;
  readonly slug: string;
  readonly shortUrl: string;
}

/** A provider adapter. Throws ShortenerError; never anything else for expected failures. */
export interface Shortener {
  readonly provider: ShortenerProvider;
  /** true/false, or null when the provider has no availability check (create answers 409). */
  available(slug: string): Promise<boolean | null>;
  create(input: { longUrl: string; slug: string | null; title: string }): Promise<CreatedLink>;
  archive(ref: string): Promise<void>;
  restore(ref: string): Promise<void>;
  /** Total clicks, or null when the provider gives none. */
  clicks(ref: string): Promise<number | null>;
}

export const SLUG_PATTERN = /^[A-Za-z0-9_-]{3,50}$/;

export const ShortLinkInputSchema = z
  .object({
    longUrl: z
      .url({ protocol: /^https?$/, error: "Enter a full web address (https://…)." })
      .max(2000),
    title: safeText(200, { allowEmpty: true }).default(""),
    /** null = the provider picks one. */
    slug: z.string().regex(SLUG_PATTERN, "3-50 letters, digits, - or _.").nullable(),
  })
  .strict();
export type ShortLinkInput = z.infer<typeof ShortLinkInputSchema>;

export interface ShortLink extends EntityMeta {
  readonly provider: ShortenerProvider;
  readonly ref: string;
  readonly slug: string;
  readonly shortUrl: string;
  readonly longUrl: string;
  readonly title: string;
  /** "tools" (a person) or the module that made it automatically (e.g. "zoom"). */
  readonly source: string;
  readonly createdBy: string | null;
  readonly archivedAt: Date | null;
}

export const shortLinkId = (provider: ShortenerProvider, slug: string) =>
  `${provider}_${slug.toLowerCase()}`;

const REASONS: Record<ShortenerFailure, string> = {
  slug_taken: "This short URL is already taken. Choose another one.",
  invalid: "The shortener refused this link. Check the address and the short URL.",
  unavailable: "The short-link services are not reachable now. Try again later.",
  not_supported: "This action is not available for this provider.",
};
export const shortenerReason = (reason: ShortenerFailure) => REASONS[reason];

/**
 * Creates on the first provider that works, in order (goppi.id, then s.id). A chosen slug is
 * checked for availability first; "taken" and "invalid" are answers about THIS link and stop
 * there (no fallback to another domain behind the person's back); only an unreachable or
 * unconfigured provider falls through to the next one.
 */
export async function createOnFirst(
  shorteners: readonly Shortener[],
  input: ShortLinkInput,
): Promise<CreatedLink & { provider: ShortenerProvider }> {
  for (const shortener of shorteners) {
    try {
      if (input.slug !== null && (await shortener.available(input.slug)) === false) {
        throw new ShortenerError("slug_taken");
      }
      const created = await shortener.create(input);
      return { ...created, provider: shortener.provider };
    } catch (error) {
      if (!(error instanceof ShortenerError) || error.reason !== "unavailable") throw error;
    }
  }
  throw new ShortenerError("unavailable");
}

/** Interactive mode: a provider failure becomes a message for staff. */
export function asRuleViolation(error: unknown): never {
  if (error instanceof ShortenerError) throw new RuleViolationError(shortenerReason(error.reason));
  throw error;
}
