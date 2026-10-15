# Audit logging

## Record

`packages/audit/src/types.ts → AuditEvent`: `actor` (staff uid + e-mail snapshot), `action`
(`AUDIT_ACTIONS`: CREATE, UPDATE, DELETE, PUBLISH, UNPUBLISH, SEND, UPLOAD, REVERT), `module`
(admin page id), `title` (record title at that time), `resourceType`, `resourceId`, `occurredAt`,
`operationId`, `before`, `after` (**only the top-level fields that changed**, `onlyChangedFields`),
`versionBefore/After`, `revertible`, `revertOf`, request metadata (`requestId`), and
`prevHash`/`hash` for a tamper-evident chain.

The Figma flowchart calls the collection `adminLogs`; here it is `auditLogs`.

## Guarantees

- **Append-only**: the package has no update/delete API (tested). The writer port only `append`s.
  The store must refuse updates/deletes for application credentials.
- **Same transaction**: the entity write and its audit event commit together.
- **Revert** (`evaluateRevert`, `buildRevertEvent`):
  - only within **14 days**, only by holders of `audit.revert`, server-side;
  - only if the entity's current version equals the event's `versionAfter` (no silent overwrite
    of later edits → `version_conflict`);
  - never twice, never a revert of a revert, never for non-revertible side effects (emails sent,
    payments);
  - produces a **new** audit event (`revertOf`), the original is untouched.
- **Deleted records** are soft-deleted; revert = undelete. Media must be retained ≥ 14 days.
- **Grouped operations** share `operationId` and are reverted as a unit.
- **Diffs** (`diffSnapshots`) are for display; full snapshots are the source of truth.
- **Personal data**: minimize registrant PII in snapshots; never snapshot secrets.

## Writing an entry (admin mutations)

```ts
const rename = createGuardedAction({
  permission: "articles.edit",
  input: RenameInput,
  handler: (input, principal, audit) =>
    db.runTransaction(async (tx) => {
      const current = await tx.get(ref); // 1. the transaction's own reads
      const log = await auditWriter.begin(tx); // 2. reads the chain head
      tx.update(ref, { title: input.title, version: current.get("version") + 1 }); // 3. writes
      log.append(
        audit({
          module: "articles",
          action: "UPDATE",
          resourceType: "content",
          resourceId: input.id,
          title: input.title,
          before: { title: current.get("title") },
          after: { title: input.title },
          versionBefore: current.get("version"),
          versionAfter: current.get("version") + 1,
        }),
      );
    }),
});
// in a server action: rename(getPrincipal, getAuditContext)(formInput)
```

- `audit(...)` (from `createGuardedAction`, `apps/admin/src/server/guarded-action.ts`) fills in the
  id, time, actor (the server-side principal + e-mail, never the input), request id and the
  operation id shared by every entry of that mutation, and keeps only the changed fields.
- `createFirestoreAuditWriter(db).begin(tx)` (`packages/db/src/firestore/audit.ts`) must be called
  after the transaction's reads and before its writes (Firestore runs all reads first). Its
  `append` queues `tx.create(auditLogs/{id})` and moves `auditChain/head`; a failed transaction
  leaves no entry.
- Personal data: build `before`/`after` with `profileAuditSnapshots` (`@website/domain/members`),
  which writes restricted fields only as `[changed]`/`[unchanged]`.
- Tests: `tests/integration/audit-writer.test.ts`, `tests/security/guarded-action.test.ts`,
  `tests/unit/audit.test.ts`.

## Audit Log page and revert

Admin `/audit` (`audit.read`, global): one card per entry, newest first, 20 per page ("Load
more"), filters admin e-mail, page (module), action and date range (UTC). Headline
`[ACTION] [Page] [title] - #[id]`, chips with the admin e-mail and the time, and the changed-field
table (Field, Before, After). Read-only: there is no edit or delete route.

**Revert** (`audit.revert`, sign-in in the last 15 minutes): the button is disabled with the
reason as tooltip — "Revert window expired" (> 14 days), "Already reverted", "A revert cannot be
reverted", "The record changed after this entry", or "This change cannot be reverted" (sends,
uploads, role and account changes, and any record type not registered for revert). Otherwise a
confirm dialog shows the same table, then ONE transaction re-checks everything
(`evaluateRevert`), writes the Before values of only the listed fields back (a create is moved to
trash, a delete is restored) with version + 1, and appends a NEW `REVERT` entry
(`buildRevertEvent`, `revertOf` = the original). A security event `audit.revert` is logged.

- Code: `apps/admin/src/app/(panel)/audit/**`, `apps/admin/src/server/audit-log.ts`
  (`REVERTIBLE_COLLECTIONS`), `packages/db/src/firestore/audit.ts` (`createFirestoreAuditStore`).
- A module makes its records revertible by adding `resourceType: "collection"` to
  `REVERTIBLE_COLLECTIONS` (its documents must carry `version`, `updatedAt`, `deletedAt`). The map
  is empty until the content modules (news, events, gallery) add theirs.
- Tests: `tests/integration/audit-log.test.ts`.

## Integrity

- Every entry has `seq`, `prevHash` and `hash = sha256(prevHash + canonicalJson(event))`
  (`prevHash` empty for the first entry); `auditChain/head` holds the newest `{ hash, seq }`.
  Because every audited transaction reads and writes the head, entries get a strict order and
  a gap or an edited entry breaks the chain.
- Only `packages/db/src/firestore/audit.ts` references `auditLogs`, and entries are only ever
  created inside a transaction (architecture test). Planned: nightly chain verification and a daily export to a
  retention-locked bucket in a separate project.
