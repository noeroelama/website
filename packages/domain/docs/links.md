# Short links

Short links (K1), ported from PPIDK `app/Support/Tautan/*` (rules only): goppi.id is the
primary provider, s.id the fallback (X3).

## What it does

Staff shorten long links on **Tools → URL Shortener** (with an optional custom slug); the
system shortens its own links (Zoom join URLs, step 7.6) without asking anyone. Every link is
kept in the history, whoever made it.

## Where it lives

- Rules and the `Shortener` port: `packages/domain/src/links/index.ts`
- Adapters: `apps/admin/src/server/shorteners.ts` (`goppiShortener`, `sidShortener`)
- Actions: `apps/admin/src/server/links.ts`; store `packages/db/src/sql/links.ts`
- Page: `/tools` (`tools-page.tsx`, `links-model.ts`); tests `tests/integration/links.test.ts`

## Rules

- **Order**: goppi.id, then s.id. Only an unreachable or unconfigured provider (network error,
  timeout, 5xx, no key) falls through to the next. "Slug taken" (409, or s.id's availability
  check) and "refused" (other 4xx) are answers about this link and are shown as they are.
- **Custom slug**: 3-50 letters, digits, `-` or `_`; checked for availability BEFORE creating
  where the provider can (s.id `POST /links/available`); goppi.id answers 409 at create time.
- **Interactive mode** (Tools page): the reason is shown (`shortenerReason`).
  **Silent mode** (`linkActions().shorten(longUrl, title, source)`): never throws; any failure
  is logged (`short link failed`) and the long URL is used instead.
- **Archive, not delete**: the provider's soft delete; the slug stays taken. Restore where the
  provider supports it (s.id); goppi.id has no known restore call yet ("not available").
- The title is ours only (history list); address and slug never change at the provider —
  archive and make a new link instead.
- **Clicks** are fetched from the provider when a link is opened (s.id stats); goppi.id reports
  none yet.
- History: `shortLinks/{id}` (provider, ref, slug, shortUrl, longUrl, title, source
  `tools`/module, createdBy, archivedAt) with the unique index `shortLinkSlugs/{provider}_{slug}`.
  Tools actions are audited (module `tools`, not revertible: the provider already changed).

## Provider APIs

| Provider      | Calls                                                                                                                                                                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| goppi.id      | `GOPPI_BASE_URL` + `Authorization: Bearer GOPPI_API_KEY`; `POST /links` {long_url, slug?, title} → {id, slug, short_url}; `PUT /links/{id}/archive`; 409 = slug taken                                                                                           |
| s.id (API v2) | `https://api.s.id/v2`, `Authorization: Bearer SHORTLINK_API_KEY`; `POST /links` {long_url, custom_slug?, title}; `POST /links/available` {custom_slug}; `DELETE /links/{short}`; `POST /links/{short}/unarchive`; `GET /links/{short}/stats`; rate limit 38/min |

Both wrap answers in `data`. Wrong field names are silently ignored by s.id, so the tests pin
every request body.

## Permissions

`tools.read` (list, clicks), `tools.edit` (create, rename, archive, restore).

## Open points

- goppi.id: the API base URL, the answer field names and whether restore/stats/availability
  exist were not available when this was built (PPIDK `PemendekGoppi.php` was not at hand);
  confirm them against PPIDK before going live.
