# Newsletter sign-up (double opt-in)

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

## Configuration

`SUBSCRIBER_HASH_SECRET` (never rotate) and `LINK_SIGNING_SECRET`, ≥ 32 characters each, plus the
captcha and e-mail settings in `apps/web/.env.example`.
