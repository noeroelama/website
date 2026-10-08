# Database

## Decision: Firestore for everything

All data — content, events, registrations, organization/chapters, members, newsletter,
audit log, API keys and the shop — lives in **Cloud Firestore**: ONE database in the one Firebase project (`ppidk-website-prod`),
shared by every environment. There is no second database.

Browsers never talk to Firestore: rules are deny-all and every read/write goes through our
servers with the Admin SDK (`infrastructure/firebase/firestore.rules`).

## Rules

- **Ports in `domain`**: each module declares the repositories it needs. Domain code never sees Firestore.
- **Adapters in `db`**: Firestore is imported only in `packages/db/src/firestore/**` (lint-enforced).
- **Per-role access**: `@website/db` exposes repositories per `DatabaseRole`
  (`web_ro`, `admin_rw`, `shop_rw`, `gateway_rw`). Firestore IAM is project-wide, so this
  per-role surface — not IAM — is what limits each app. Separate service accounts still give
  separate audit trails and independent revocation.
- **No UI database access**: apps reach `@website/db` only from `src/server/**`.
- **Every editable document** has `version` (optimistic concurrency), `createdAt`, `updatedAt`,
  `deletedAt` (soft delete). Writes are transactions conditional on `version`.

## Collections

| Collection                  | Doc id                   | Contents                                                       | Notes                                                                          |
| --------------------------- | ------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `users`                     | Firebase uid             | email, status, `roleAssignments[]`, createdAt, lastSignInAt    | One record per account (staff, members, customers). Roles = RBAC.              |
| `memberProfiles`            | Firebase uid             | Personal data — see `packages/domain/docs/members.md`          | Separate from `users` so role checks/listings never load PII.                  |
| `countries`                 | ISO alpha-2              | name                                                           | PPI countries                                                                  |
| `chapters`                  | slug                     | name, countryCode, active                                      |                                                                                |
| `content`                   | id                       | kind (news/article/page), slug, status, publishAt, chapterId   | Scheduled publishing = read-time rule                                          |
| `galleries`, `galleryItems` | id                       | metadata + Storage paths                                       | Image bytes in Cloud Storage                                                   |
| `events`                    | id                       | schedule, capacity, chapterId, published                       |                                                                                |
| `eventRegistrations`        | `{eventId}_{uid}`        | status, timestamps                                             | Deterministic id ⇒ one per user per event. No PII copied.                      |
| `eventCounters`             | eventId                  | confirmed/waitlisted counts                                    | Updated in the registration transaction. Shard if an event exceeds ~1 write/s. |
| `subscribers`               | normalized email hash    | status, confirmedAt                                            | Newsletter double opt-in                                                       |
| `products`, `categories`    | id                       | catalog                                                        | Shop                                                                           |
| `carts`                     | uid                      | lines                                                          |                                                                                |
| `orders`                    | id                       | userId, lines (price snapshot), totals in minor units, status  | Status changes in transactions                                                 |
| `inventory`                 | productId                | stock                                                          | Decremented in the order transaction                                           |
| `paymentEvents`             | provider event id        | processedAt                                                    | Webhook de-duplication; provider is source of truth for payment state          |
| `auditLogs`                 | id                       | append-only events (`packages/audit`)                          | PII redacted                                                                   |
| `apiKeys`                   | keyId                    | secret hash, scopes, expiry                                    |                                                                                |
| `idempotencyKeys`           | key                      | response hash, expiresAt (TTL)                                 | Gateway writes                                                                 |
| `rateLimits`                | `ip_<hmac>` / `key_<id>` | per-minute and per-day counters, `expiresAt` (TTL)             | Written in a transaction by `createFirestoreRateLimitStore`                    |
| `passkeys`                  | sha256(credential id)    | userId, public key, counter, transports, createdAt, lastUsedAt | `createFirestorePasskeyStore`; counter updated in a transaction                |
| `webauthnChallenges`        | random id                | challenge, userId, expiresAt (TTL)                             | Single-use: read-and-delete in a transaction                                   |
| `emailLog`, `zoomRequests`  | id                       | status sent/failed                                             | Manual retry from admin                                                        |

## Where Firestore needs care (known trade-offs)

| Area                   | Risk                                    | Mitigation                                                                                                        |
| ---------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Shop orders/inventory  | No multi-document constraints           | Transactions for order + inventory + counters; payment provider is source of truth; nightly reconciliation report |
| Popular event capacity | Hot counter document                    | Transaction on `eventCounters`; distributed counter if needed                                                     |
| Reporting/exports      | No SQL, no joins                        | Purpose-built queries + composite indexes; scheduled exports to BigQuery later if reporting grows                 |
| Search                 | No full-text search                     | Prefix fields for small lists; external search only when needed                                                   |
| Audit immutability     | Admin SDK can technically update/delete | No update/delete code path; hash chain; daily export to a locked bucket                                           |

## Roles → credentials

| Role         | App     | Service account                                                     |
| ------------ | ------- | ------------------------------------------------------------------- |
| `web_ro`     | web     | `web` SA — public reads + own profile writes via repository surface |
| `admin_rw`   | admin   | `admin` SA                                                          |
| `shop_rw`    | shop    | `shop` SA                                                           |
| `gateway_rw` | gateway | `gateway` SA, pool capped by `GATEWAY_DB_MAX_CONNECTIONS`           |

## Performance rules

- **Connection pooling**: `getFirestoreForRole()` creates one client per role per server process
  and reuses it for every request; the client keeps its gRPC channels open. Never create a client per request.
- **No N+1 queries**: to load documents for a list (e.g. the profiles of an event's registrants),
  collect the ids and call `getDocumentsByIds(db, collection, ids)` — one round trip per 100 ids,
  duplicates fetched once. Never call `doc(id).get()` inside a loop.
- **Race conditions**: read-modify-write goes through `runTransaction`; editable documents also
  carry `version` for optimistic concurrency (stale writes fail with `ConcurrencyConflictError`,
  shown to staff as "conflict").
