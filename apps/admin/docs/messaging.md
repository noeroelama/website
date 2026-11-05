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
| Finance request `submitted` / `reviewed` / `authorized`                                                                         | holders of `finance.review` / `finance.authorize` / `finance.pay`                            | `finance:{id}:{status}:{version}:{uid}`          |
| Finance request returned (`revision`), `rejected` or `paid`                                                                     | the requester (with the note)                                                                | same                                             |

Desk holders = active accounts whose CUSTOM role holds the permission and whose assignment
covers the letter's unit (scope, active period, not revoked); superadmins are not desk holders.
LPJ desks (`notices.lpj`, key `lpj:{id}:{status}:{version}:{uid}`): programme finished → its
PICs with the due date; submitted → holders of `lpj.review_secretariat` and
`lpj.review_treasurer`; both reviews in → holders of `lpj.approve`; returned (with the note) or
approved → the PICs. Finance desks: see the finance rows above.

## Satisfaction polls (J3)

After LPJ `approved` (the PICs), finance `paid` (the requester) and recruitment `confirmed`
(the applicant), people with a WhatsApp number get a single-answer WAHA poll (1-5 stars,
`src/server/polls.ts`): once per event and person (`surveys/{sha256(source:id:uid)}` claimed
first), the options frozen on the survey (label → stars), the same delivery rules as messages
(`log` never sends; outside production only to test recipients). Votes arrive at
`POST /webhooks/waha` (HMAC-SHA512 of the body in `X-Webhook-Hmac` with `WAHA_WEBHOOK_SECRET`;
de-duplicated per vote, choice and time, so a changed vote counts and a retry does not) and are
stored by the poll's message id. The Email page shows asked / answered / average / 1-5 counts
per source for the last 12 months. [OWNER] WAHA dashboard → webhook URL
`https://<admin domain>/webhooks/waha`, event `poll.vote`, HMAC key = `WAHA_WEBHOOK_SECRET`.

## WhatsApp chatbot (C4)

`/webhooks/whatsapp` (`src/server/chatbot.ts`): GET answers Meta's verify-token handshake
(`WHATSAPP_CLOUD_VERIFY_TOKEN`); POST checks `X-Hub-Signature-256` (HMAC-SHA256 of the body with
`WHATSAPP_CLOUD_APP_SECRET`), de-duplicates each message by its id (`webhookEvents`) and replies
through the Meta Cloud API (`WHATSAPP_CLOUD_PHONE_NUMBER_ID`, `WHATSAPP_CLOUD_TOKEN`; replies only,
inside the free 24-hour window; anything proactive stays on WAHA).

- Keywords: `menu` (also halo/hai), `bantuan`, `batal`, `daftar` (sign-up), `oprec`.
- Sign-up: name → e-mail → chapter (numbered list) → campus (approved universities of the
  chapter's country, matched on the normalised name; the optional Gemini matcher
  (`GEMINI_API_KEY`, X4) only when nothing matched) → pick → confirm `ya` → the Firebase account
  is found or created (unverified, no password; `createFirebaseAccountCreator`) and its
  `users/{uid}` record made as on a first sign-in; the reply links `/login` (Google or "forgot
  password") to complete the profile on the website.
- Oprec: numbered open recruitments → the website's apply link (signed-in apply; the
  personality test link is on the application page).
- State: `whatsappConversations/{keyedHash(phone)}` (SUBSCRIBER_HASH_SECRET) with a 30-minute
  life (`expiresAt`, deleted by the `expire` job); the number itself is never stored.
- Not built: WhatsApp Flows for the Oprec questions (X5). Applying stays on the website until the
  Meta Flow set-up exists; the chatbot sends the link instead.

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
`WAHA_SESSION` (default `default`), `WAHA_WEBHOOK_SECRET` (poll votes) — see `docs/environment.md`. Without a Resend key
or sender, live sends fail with `not_configured` (visible on the Email page).
