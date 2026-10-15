# Messaging (e-mail) and the Messages page

## What it does

Every outgoing message goes through one port with an **idempotency key** and is written to a
message log (outbox) first, so the same message is never sent twice — not on a double click,
not on a retry. Today the channel is e-mail (Resend); WhatsApp is added as a second channel
later. Staff see the e-mails that failed on the admin **Messages** page and can retry them.

## Where it lives

- Rules and orchestration: `packages/domain/src/messaging` (`createMessenger`,
  `deliveryDecision`, `isValidMessageKey`, `MessageChannel` and `MessageLogStore` ports).
- Log: `packages/db/src/firestore/messages.ts` (`createFirestoreMessageLog`, collection
  `messageLog/{sha256(key)}`).
- Admin: `src/server/messaging.ts` (`emailChannel`, retry action), `src/server/wiring.ts`
  (`messenger()`), page `src/app/(panel)/messages/**` (`messages.read` / `messages.edit`).
- Tests: `tests/integration/messaging.test.ts`.

## How to use it

```ts
// inside a server action, AFTER the transaction that caused the message has committed
await messenger().send(
  { channel: "email", to: user.email, subject, text, html },
  `event:${eventId}:registered:${uid}`,
);
// → "sent" | "failed" | "skipped" | "logged" | "blocked" | "duplicate"
```

Keys are meaningful and stable: `<topic>:<id>:<event>[:…]` (letters, digits, `_ - . @`). The
same key always means the same message. Web server code (newsletter, step 2.8) uses the same
`createMessenger` + `createFirestoreMessageLog` once its dependency matrix allows
`domain/messaging`.

## Rules and assumptions

- The key is claimed in a transaction (create-if-absent); a second call with the same key
  returns `duplicate` and sends nothing. The provider also gets the key (`Idempotency-Key`).
- No address → `skipped`. Provider error or timeout → `failed` with the reason; staff retry
  from the Messages page (only failed entries; the entry is set back to `queued` atomically).
- Every environment works on the live data, so `MESSAGING_MODE=log` (default) only records.
  `live` sends in production; in any other environment it sends only to
  `MESSAGING_TEST_RECIPIENTS` and records everyone else as `blocked`.
- The log stores the recipient and the content (needed to retry). Do not put secrets in
  messages.

## Configuration

`MESSAGING_MODE` (`log` | `live`), `MESSAGING_TEST_RECIPIENTS` (comma-separated e-mails),
`RESEND_API_KEY`, `EMAIL_FROM_TRANSACTIONAL` — see `docs/environment.md`. Without a Resend key
or sender, live sends fail with `not_configured` (visible on the Messages page).
