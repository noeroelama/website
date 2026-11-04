import "server-only";
import { ShortenerError, type CreatedLink, type Shortener } from "@website/domain/links";

type Json = Record<string, unknown>;

/** HTTP status → the port's failure (409 taken, other 4xx refused, the rest unreachable). */
const failure = (status: number) =>
  new ShortenerError(
    status === 409 ? "slug_taken" : status >= 400 && status < 500 ? "invalid" : "unavailable",
    `http_${status}`,
  );

/** One JSON call with a timeout; network errors and timeouts are "unavailable". */
async function call(
  fetchImpl: typeof fetch,
  url: string,
  apiKey: string,
  method: string,
  body?: Json,
): Promise<Json> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ShortenerError("unavailable", "network");
  }
  if (!response.ok) throw failure(response.status);
  const parsed = (await response.json().catch(() => ({}))) as unknown;
  const json = (parsed && typeof parsed === "object" ? parsed : {}) as Json;
  // Both providers wrap the record in `data`.
  return (json["data"] && typeof json["data"] === "object" ? json["data"] : json) as Json;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const unconfigured = (): never => {
  throw new ShortenerError("unavailable", "not_configured");
};

/**
 * goppi.id (primary, X3). Create `POST {base}/links` with `long_url`, optional `slug`, `title`;
 * links are managed by id; archive `PUT {base}/links/{id}/archive`; a taken slug answers 409.
 * shortcut: no availability, restore or click endpoints are known from PPIDK, so those answer
 * "unknown"/"not supported"; add them when the goppi.id API documents them.
 */
export function goppiShortener(
  config: { baseUrl: string; apiKey: string } | null,
  fetchImpl: typeof fetch,
): Shortener {
  const base = config?.baseUrl.replace(/\/+$/, "") ?? "";
  const api = (path: string, method: string, body?: Json) =>
    config ? call(fetchImpl, `${base}${path}`, config.apiKey, method, body) : unconfigured();
  return {
    provider: "goppi",
    available: () => Promise.resolve(null),
    async create(input): Promise<CreatedLink> {
      const data = await api("/links", "POST", {
        long_url: input.longUrl,
        title: input.title,
        ...(input.slug ? { slug: input.slug } : {}),
      });
      const slug = text(data["slug"]) || input.slug || "";
      const id = data["id"];
      const ref = typeof id === "number" || typeof id === "string" ? String(id) : "";
      if (!ref || !slug) throw new ShortenerError("unavailable", "bad_answer");
      return { ref, slug, shortUrl: text(data["short_url"]) || `https://goppi.id/${slug}` };
    },
    async archive(ref) {
      await api(`/links/${encodeURIComponent(ref)}/archive`, "PUT");
    },
    restore: () => Promise.reject(new ShortenerError("not_supported")),
    clicks: () => Promise.resolve(null),
  };
}

/**
 * s.id API v2 (fallback): base https://api.s.id/v2; create `POST /links` with `long_url`,
 * optional `custom_slug`, `title`; archive `DELETE /links/{short}`; restore
 * `POST /links/{short}/unarchive`; clicks `GET /links/{short}/stats`; availability
 * `POST /links/available`. Wrong field names are silently ignored by s.id (tests pin them).
 */
export function sidShortener(apiKey: string | null, fetchImpl: typeof fetch): Shortener {
  const api = (path: string, method: string, body?: Json) =>
    apiKey ? call(fetchImpl, `https://api.s.id/v2${path}`, apiKey, method, body) : unconfigured();
  return {
    provider: "sid",
    async available(slug) {
      const data = await api("/links/available", "POST", { custom_slug: slug });
      return data["available"] === true;
    },
    async create(input): Promise<CreatedLink> {
      const data = await api("/links", "POST", {
        long_url: input.longUrl,
        title: input.title,
        ...(input.slug ? { custom_slug: input.slug } : {}),
      });
      const short = text(data["short"]) || text(data["custom_slug"]) || input.slug || "";
      if (!short) throw new ShortenerError("unavailable", "bad_answer");
      return {
        ref: short,
        slug: short,
        shortUrl: text(data["short_url"]) || `https://s.id/${short}`,
      };
    },
    async archive(ref) {
      await api(`/links/${encodeURIComponent(ref)}`, "DELETE");
    },
    async restore(ref) {
      await api(`/links/${encodeURIComponent(ref)}/unarchive`, "POST");
    },
    async clicks(ref) {
      const data = await api(`/links/${encodeURIComponent(ref)}/stats`, "GET");
      const total = data["clicks"] ?? data["total_clicks"];
      return typeof total === "number" ? total : null;
    },
  };
}
