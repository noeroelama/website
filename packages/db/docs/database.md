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

| Collection                  | Doc id                   | Contents                                                                                                                          | Notes                                                                                                      |
| --------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `users`                     | Firebase uid             | uid, email, name, status, `roleAssignments[]` (`{ roleId, scope }`), `roleIds[]` (for queries), version, createdAt, lastSignInAt  | One record per account (staff, members, customers), created on the first sign-in. Roles = RBAC. See below. |
| `roles`                     | role id (slug)           | name, permissions[] (admin-page permissions), version, timestamps, deletedAt                                                      | Custom roles from the admin Roles page. Built-in roles (superadmin, member, user) are code, never stored.  |
| `memberProfiles`            | Firebase uid             | Personal data — see `packages/domain/docs/members.md`                                                                             | Separate from `users` so role checks/listings never load PII.                                              |
| `countries`                 | ISO alpha-2              | name                                                                                                                              | PPI countries                                                                                              |
| `chapters`                  | slug                     | name, countryCode, active                                                                                                         |                                                                                                            |
| `content`                   | id                       | kind (news/article/page), slug, status, publishAt, chapterId                                                                      | Scheduled publishing = read-time rule                                                                      |
| `galleries`, `galleryItems` | id                       | metadata + Storage paths                                                                                                          | Image bytes in Cloud Storage                                                                               |
| `events`                    | id                       | schedule, capacity, chapterId, published                                                                                          |                                                                                                            |
| `eventRegistrations`        | `{eventId}_{uid}`        | status, timestamps                                                                                                                | Deterministic id ⇒ one per user per event. No PII copied.                                                  |
| `eventCounters`             | eventId                  | confirmed/waitlisted counts                                                                                                       | Updated in the registration transaction. Shard if an event exceeds ~1 write/s.                             |
| `subscribers`               | normalized email hash    | status, confirmedAt                                                                                                               | Newsletter double opt-in                                                                                   |
| `products`, `categories`    | id                       | catalog                                                                                                                           | Shop                                                                                                       |
| `carts`                     | uid                      | lines                                                                                                                             |                                                                                                            |
| `orders`                    | id                       | userId, lines (price snapshot), totals in minor units, status                                                                     | Status changes in transactions                                                                             |
| `inventory`                 | productId                | stock                                                                                                                             | Decremented in the order transaction                                                                       |
| `paymentEvents`             | provider event id        | processedAt                                                                                                                       | Webhook de-duplication; provider is source of truth for payment state                                      |
| `auditLogs`                 | event id                 | append-only events (`packages/audit`): action, module, title, actor (uid + email), changed fields only, `seq`, `prevHash`, `hash` | Created only by `createFirestoreAuditWriter` in the record's transaction; PII redacted                     |
| `auditChain`                | `head`                   | `{ hash, seq }` of the newest audit entry                                                                                         | Read and written in every audited transaction                                                              |
| `apiKeys`                   | keyId                    | secret hash, scopes, expiry                                                                                                       |                                                                                                            |
| `idempotencyKeys`           | key                      | response hash, expiresAt (TTL)                                                                                                    | Gateway writes                                                                                             |
| `rateLimits`                | `ip_<hmac>` / `key_<id>` | per-minute and per-day counters, `expiresAt` (TTL)                                                                                | Written in a transaction by `createFirestoreRateLimitStore`                                                |
| `passkeys`                  | sha256(credential id)    | userId, public key, counter, transports, createdAt, lastUsedAt                                                                    | `createFirestorePasskeyStore`; counter updated in a transaction                                            |
| `webauthnChallenges`        | random id                | challenge, userId, expiresAt (TTL)                                                                                                | Single-use: read-and-delete in a transaction                                                               |
| `emailLog`, `zoomRequests`  | id                       | status sent/failed                                                                                                                | Manual retry from admin                                                                                    |

## Users and roles

Code: `src/users.ts` (ports + parsing), `src/firestore/users.ts`. Tests: `tests/integration/users.test.ts`.

| Function                                    | Used by                              | What it does                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createFirestoreUserStore(db).recordSignIn` | web `POST /api/session` (`onSignIn`) | One transaction: creates `users/{uid}` on the first sign-in (`status: "active"`, role `user`, `createdAt`), otherwise only updates `lastSignInAt`, `email`, `name`. Never changes roles.                                                                                                                                                    |
| `.findPrincipalByUid(uid)`                  | admin `src/server/user-directory.ts` | Reads `users/{uid}` and its custom roles (`getDocumentsByIds`, one read) → `Principal`. No record → `null`; `status: "inactive"` → a principal that can do nothing; unknown/deleted roles dropped.                                                                                                                                          |
| `createFirestoreRoleStore(db)`              | admin (Roles/Users pages)            | `list()`, `get(id)`, `getMany(ids)`: built-in roles (`superadmin`, `member`, `user`) come from code; a stored document with a built-in id is ignored, deleted roles (`deletedAt`) are hidden. `countHolders(ids)` (count queries), `save` / `remove` (soft delete) in one transaction with a `decide` callback (rules) and the audit entry. |
| `createFirestoreAccountStore(db)`           | admin Users page                     | `list({ roleId, status, cursor, limit })` (order: email, uid), `get(uid)`, `change(uid, version, decide, change, audit)`: one transaction reads the account and every superadmin holder, `decide` may refuse, then roles/status/`roleIds`/version and the audit entry are written.                                                          |

The uid always comes from the verified session cookie. Malformed stored data (bad role ids,
unknown scope types) is dropped, never trusted. `@website/db` depends on `@website/permissions`
for the role types and `resolveAssignments`.

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
