# Cron jobs and incoming webhooks

## What it does

Work that must happen without a visitor (reminders, retries, newsletter batches) runs as a
**cron job**: cPanel → Cron Jobs calls `GET https://admin.<domain>/cron/<job>` with a bearer
secret; the job handles one bounded batch and answers a JSON summary. Third-party callbacks
arrive as **webhooks** at `POST /webhooks/<provider>` (DEC-5).

## Where it lives

- Cron: `src/server/cron.ts` (`CRON_JOBS`, `createCronRoute`), route `src/app/cron/[job]/route.ts`.
- Webhooks: `ADMIN_WEBHOOK_PATHS` in `src/server/request-guard.ts`; `verifyHmacSignature` in
  `@website/security`; `createFirestoreWebhookEventStore` in `@website/db/firestore`.
- Tests: `tests/security/cron-and-webhooks.test.ts`.

## How to use it

One-time on the server (cPanel Terminal):

```bash
mkdir -p ~/.config/ppidk
printf '%s' '<CRON_SECRET value>' > ~/.config/ppidk/cron-secret
chmod 600 ~/.config/ppidk/cron-secret
```

Then one line per job in **cPanel → Cron Jobs** (the interval depends on the job and on the
shortest interval the hosting plan allows, see `docs/deployment.md#limits`):

```bash
curl -fsS --max-time 50 -H "Authorization: Bearer $(cat ~/.config/ppidk/cron-secret)" https://admin.<domain>/cron/<job> >/dev/null
```

| Job               | Schedule                    | What it does                                                                                                                                 |
| ----------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `noop`            | once, by hand, after set-up | Answers `{ processed: 0 }`: checks the wiring.                                                                                               |
| `newsletter-send` | every 5 minutes             | Sends the next 100 recipients of the oldest due campaign (scheduled time reached, or already sending); `packages/domain/docs/newsletter.md`. |

Adding a job: write it as `() => Promise<summary>` in `CRON_JOBS` (or, when it needs stores or
the messenger, next to `newsletter-send` in the `cronRoute` jobs of `src/server/wiring.ts`), idempotent (use meaningful
keys so a repeated call changes nothing), one bounded batch per call (target < 30 s), progress
stored in Firestore; then add its row above and its crontab line on the server.

Adding a webhook provider: add `/webhooks/<provider>` to `ADMIN_WEBHOOK_PATHS` (skips ONLY the
origin check; rate limit and no-store still apply), create `src/app/webhooks/<provider>/route.ts`
that (1) limits the body size, (2) checks the signature with `verifyHmacSignature` (and the
timestamp tolerance), (3) calls `record(provider, eventId, now)` and stops when it returns false
(replay), (4) does the work and answers a short generic body.

## Rules and assumptions

- Wrong or missing secret → 401 (also for unknown jobs, so job names are not revealed);
  unknown job → 404; a failing job → 500 with a generic body, the error goes to `stderr.log`.
- The secret is compared in constant time (`bearerTokenMatches`) and never written in the
  repository or in the crontab line itself.
- Cron and webhook paths never redirect to sign-in (no session).
- `webhookEvents/{provider}_{eventId}` keeps 30 days (`expiresAt`, TTL policy).

## Configuration

`CRON_SECRET` (admin, ≥ 32 characters) — `docs/environment.md`. Each provider's webhook secret
is added with that provider's step.
