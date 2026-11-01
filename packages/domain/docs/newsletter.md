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
- Database: `packages/db/src/sql/subscribers.ts` (`subscribers/{emailHash}`)
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
  `sendState`, `canChangeCampaign`, `canDeleteCampaign`, `isDue`, `maskEmail`, `unsubscribeLinkData`,
  tracking and stats helpers); stores `packages/db/src/sql/campaigns.ts` (`campaigns/{id}`,
  web side `createSqlCampaignWebStore`) and `subscribers.ts`; actions and the cron job in
  `apps/admin/src/server/newsletter.ts`; page `apps/admin/src/components/newsletter-page.tsx`;
  web routes `apps/web/src/app/newsletter/{o,c,[id]}`. Tests: `tests/unit/newsletter.test.ts`,
  `tests/integration/newsletter-campaigns.test.ts`, `tests/integration/newsletter-signup.test.ts`.
- Composer (`newsletter.edit`): subject + rich text (same editor and sanitiser as news; inline
  images use the upload preset `newsletter`). **Preview** shows the e-mail in a sandboxed frame
  (no scripts), saved or not. Drafts and scheduled campaigns can be edited.
- Delete (`newsletter.edit`): soft delete, revertible on the Audit Log for 14 days (`campaign` in
  `REVERTIBLE_COLLECTIONS`). Any campaign except one that is being sent (`canDeleteCampaign`); a
  deleted sent campaign also disappears from the public archive.
- Publish / Schedule (`newsletter.send`): send now (status `sending`) or at a chosen time (status
  `scheduled`); row menu or the selection's bulk **Publish** (drafts and scheduled only). Audited
  `SEND`, not revertible. **Send Test** mails the saved campaign to the signed-in staff member's own
  address only (no tracking).
- Delivery: cron job `newsletter-send` (`apps/admin/docs/cron.md`) takes the next 100 confirmed
  subscribers (stable id order, `cursor` on the campaign) of the oldest due campaign. Every e-mail
  has the key `newsletter:{campaignId}:{subscriberId}` and its own signed unsubscribe link, so a
  run that crashed half-way repeats its batch and the message log refuses the duplicates.
  Only confirmed, not deleted subscribers are ever mailed (`canReceiveCampaigns`).
- Open and click rates: each e-mail carries an open pixel (`/newsletter/o?t=`) and every http(s)
  link is rewritten to `/newsletter/c?t=` (`trackLinks`); both are signed (`trackingLinkData`,
  LINK_SIGNING_SECRET). The web store writes one marker per subscriber in `campaignTracking` and
  raises `openCount` / `clickCount` on the campaign only for a new marker; a click also counts as
  an open. Rates = count / sentCount (`campaignRates`); the header shows the mean of the last 5
  sent campaigns and the change against the 5 before (`recentRates`). Opens are approximate (mail
  apps that preload or block images); a counter error is logged, never shown to the reader.
- Copy Link: `WEB_URL/newsletter/{id}`, the public archive page of a sent (or sending) campaign
  (`isPublicCampaign`).
- Subscriber list (`newsletter.read`): addresses and names are hidden (`s***@example.org`) unless
  the viewer has `newsletter.edit`. Header numbers: **Active subscribers** (confirmed, not deleted)
  and how many confirmed this month (`subscriberStats`). Filters: status, PPI, joined date.
- **Add New Subscriber** / **Import CSV** (`newsletter.edit`): still double opt-in — the person
  gets the confirmation e-mail (bilingual, same key `newsletter:{id}:optin:{n}` as the website)
  and stays Pending until they confirm. Name and PPI (chapter) are set only here. Existing
  (confirmed or pending) addresses are left alone and someone who unsubscribed is never
  re-mailed by staff (`staffOptInDecision`). Import: header row with `email` (required), `name`,
  `ppi` (the PPI's name, matched case-insensitively), at most 200 rows (`parseSubscriberCsv`);
  invalid rows are reported by line number. Audited `CREATE` (masked address, not revertible).
- Delete subscriber (`newsletter.edit`): soft delete, revertible for 14 days (`subscriber` in
  `REVERTIBLE_COLLECTIONS`; `version` on the record). A deleted person who signs up again on the
  website starts a fresh opt-in.
- **Export CSV** needs `newsletter.export` and is logged as the security event `data.export`
  (columns email, name, status, subscribed, confirmed).

## Configuration

`SUBSCRIBER_HASH_SECRET` (never rotate) and `LINK_SIGNING_SECRET`, ≥ 32 characters each, plus the
captcha and e-mail settings in `apps/web/.env.example`. Admin needs the same
`LINK_SIGNING_SECRET` (unsubscribe, open and click links), the same `SUBSCRIBER_HASH_SECRET`
(Add / Import) and `WEB_URL`.
