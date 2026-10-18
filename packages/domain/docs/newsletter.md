# Newsletter: sign-up (double opt-in) and campaigns

## What it does

Visitors type their e-mail address in the newsletter field (Home and every page footer). They get
a confirmation e-mail; the subscription is active only after they open the link and press
**Confirm**. Every campaign e-mail (step 2.9) carries a signed unsubscribe link.

## Where it lives

- Rules: `packages/domain/src/newsletter/index.ts` (`NewsletterEmailSchema`, `optInDecision`,
  `confirmDecision`, `OPTIN_TTL_MS`, `canReceiveCampaigns`)
- Signed links and keyed hashes: `packages/security/src/signatures.ts` (`signLink`, `verifyLink`,
  `keyedHash`) — the one implementation later steps reuse
- Firestore: `packages/db/src/firestore/subscribers.ts` (`subscribers/{emailHash}`)
- Web: `apps/web/src/server/newsletter.ts` (rules), `newsletter-wiring.ts`, field
  `src/components/newsletter-field.tsx`, pages `src/app/newsletter/{confirm,unsubscribe}`
- Tests: `tests/unit/newsletter.test.ts`, `tests/security/signed-links.test.ts`,
  `tests/integration/newsletter-signup.test.ts`

## Rules and assumptions

- reCAPTCHA v3 (action `newsletter`) is checked first; a refusal writes nothing.
- The answer to every valid address is "check your inbox" — new, pending and already confirmed
  alike — so nobody can find out who is subscribed. Only an invalid address gets an inline error.
- A pending record with a live link is left alone (no second e-mail); an expired one, or an
  unsubscribed address, starts a new opt-in (`optIns` + 1, message key
  `newsletter:{emailHash}:optin:{n}`).
- The confirmation token is 32 random bytes; only its SHA-256 is stored; it works once and for
  48 hours.
- The document id is `HMAC(SUBSCRIBER_HASH_SECRET, normalised e-mail)`: the address never
  appears in a URL, a message key or an application log (it is stored in the record, which is
  needed to send).
- Opening a confirm or unsubscribe link does nothing by itself: the page shows a button (POST),
  so mail scanners that open links cannot confirm or unsubscribe for someone.
- Unsubscribe links are signed with `LINK_SIGNING_SECRET` (no expiry); a changed link is refused.

## Campaigns and the subscriber list (admin Newsletter page)

- Code: rules in `packages/domain/src/newsletter/index.ts` (`Campaign`, `CampaignInputSchema`,
  `sendState`, `canChangeCampaign`, `isDue`, `maskEmail`, `unsubscribeLinkData`); store
  `packages/db/src/firestore/campaigns.ts` (`campaigns/{id}`), subscriber reader in
  `subscribers.ts`; actions and the cron job in `apps/admin/src/server/newsletter.ts`; page
  `apps/admin/src/components/newsletter-page.tsx`. Tests: `tests/integration/newsletter-campaigns.test.ts`.
- Composer (`newsletter.edit`): subject + rich text (same editor and sanitiser as news; inline
  images use the upload preset `newsletter`). Drafts and scheduled campaigns can be edited and
  deleted (soft delete); a sending or sent one cannot.
- Send (`newsletter.send`): now (status `sending`) or at a chosen time (status `scheduled`);
  audited `SEND`, not revertible. **Send Test** mails the saved campaign to the signed-in staff
  member's own address only.
- Delivery: cron job `newsletter-send` (`apps/admin/docs/cron.md`) takes the next 100 confirmed
  subscribers (stable id order, `cursor` on the campaign) of the oldest due campaign. Every e-mail
  has the key `newsletter:{campaignId}:{subscriberId}` and its own signed unsubscribe link, so a
  run that crashed half-way repeats its batch and the message log refuses the duplicates.
  Only confirmed subscribers are ever mailed.
- Subscriber list (`newsletter.read`): addresses are masked (`s***@example.org`) unless the
  viewer has `newsletter.edit`. **Export CSV** needs `newsletter.export` and is logged as the
  security event `data.export`. There is no manual add or import: everyone joins through double
  opt-in.
- Open and click rates are not collected.

## Configuration

`SUBSCRIBER_HASH_SECRET` (never rotate) and `LINK_SIGNING_SECRET`, ≥ 32 characters each, plus the
captcha and e-mail settings in `apps/web/.env.example`. Admin needs the same
`LINK_SIGNING_SECRET` and `WEB_URL` for unsubscribe links. Firestore index
`subscribers (status, subscriberId)`.
