# Messaging (e-mail, WhatsApp), notifications and the Email page

## What it does

Every outgoing message goes through one port with an **idempotency key** and is written to a
message log (outbox) first, so the same message is never sent twice — not on a double click,
not on a retry. Channels: e-mail (Resend) and WhatsApp (WAHA, proactive messages; chatbot
replies through the Meta Cloud API come with step 7.11). Staff see the messages that failed on the admin **Email** page (`/emails`, side panel) and can retry
them. It replaced the separate Messages page and the mock Emails page of the account menu.

## Where it lives

- Rules and orchestration: `packages/domain/src/messaging` (`createMessenger`,
  `deliveryDecision`, `isValidMessageKey`, `MessageChannel` and `MessageLogStore` ports).
- Log: `packages/db/src/sql/messages.ts` (`createSqlMessageLog`, collection
  `messageLog/{sha256(key)}`).
- E-mail channel: `packages/email/src/channel.ts` (`emailChannel`, shared by admin and web).
- WhatsApp channel (admin only): `src/server/whatsapp.ts` (`wahaChannel`: `POST
{WAHA_BASE_URL}/api/sendText` with `X-Api-Key`, chat id `6281…@c.us` from the E.164 number,
  the subject in bold above the text, 10 s timeout; errors `not_configured`, `waha_<status>`,
  `waha_unreachable`). The website has no WhatsApp channel: such a message fails as
  `not_configured`.
- Notifications (J2): `src/server/notices.ts` (`createNotices`), recipients from
  `createSqlContactReader` (`packages/db/src/sql/messages.ts`).
- Admin: `src/server/messaging.ts` (retry action), `src/server/wiring.ts` (`messenger()`), page
  `src/app/(panel)/emails/**` (`messages.read` / `messages.edit`).
- Web: `apps/web/src/server/messaging.ts` (`messenger()` for confirmation e-mails, same log, so
  failed ones show up on the admin Email page).
- Tests: `tests/integration/messaging.test.ts`, `tests/integration/notices.test.ts`.

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
`createMessenger` + `createSqlMessageLog` once its dependency matrix allows
`domain/messaging`.

## Who gets which channel

`messageTo(contact, content)`: WhatsApp when the person's member profile has a WhatsApp number
(`memberProfiles.whatsappNumber`, E.164), else the account e-mail, else `skipped`. The number is
read by the system only to deliver; the Email page shows only its last four digits.

## Notification sources (J2)

Sent after the action's transaction committed; a failure is logged (`notice failed`) and never
undoes the decision. Texts are Indonesian then English, with a link.

| Event                                                                                                                           | To                                                                                           | Key                                              |
| ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Application → revision, admin_rejected, interview, offered, rejected, approved (incl. a returned pact with its note), confirmed | the applicant                                                                                | `recruitment:{applicationId}:{status}:{version}` |
| Letter submitted (`review`)                                                                                                     | holders of `letters.review`                                                                  | `letter:{id}:{status}:{version}:{uid}`           |
| Letter passed (`corrected`, no desk signed yet)                                                                                 | holders of `letters.sign` (+ `letters.sign_coordinator` when the type needs the Coordinator) | same                                             |
| Letter `approved`                                                                                                               | holders of `letters.issue`                                                                   | same                                             |
| Letter returned to draft                                                                                                        | its author, with the note                                                                    | same                                             |

Desk holders = active accounts whose CUSTOM role holds the permission and whose assignment
covers the letter's unit (scope, active period, not revoked); superadmins are not desk holders.
LPJ desks (`notices.lpj`, key `lpj:{id}:{status}:{version}:{uid}`): programme finished → its
PICs with the due date; submitted → holders of `lpj.review_secretariat` and
`lpj.review_treasurer`; both reviews in → holders of `lpj.approve`; returned (with the note) or
approved → the PICs. Finance desks add their rows when they are built.

## Rules and assumptions

- The key is claimed in a transaction (create-if-absent); a second call with the same key
  returns `duplicate` and sends nothing. The provider also gets the key (`Idempotency-Key`).
- No address → `skipped`. Provider error or timeout → `failed` with the reason; staff retry
  from the Email page (only failed entries; the entry is set back to `queued` atomically).
- Every environment works on the live data, so `MESSAGING_MODE=log` (default) only records.
  `live` sends in production; in any other environment it sends only to
  `MESSAGING_TEST_RECIPIENTS` and records everyone else as `blocked`.
- The log stores the recipient and the content (needed to retry). Do not put secrets in
  messages.

## Configuration

`MESSAGING_MODE` (`log` | `live`), `MESSAGING_TEST_RECIPIENTS` (comma-separated e-mails and/or
E.164 numbers), `RESEND_API_KEY`, `EMAIL_FROM_TRANSACTIONAL`, `WAHA_BASE_URL`, `WAHA_API_KEY`,
`WAHA_SESSION` (default `default`) — see `docs/environment.md`. Without a Resend key
or sender, live sends fail with `not_configured` (visible on the Email page).
