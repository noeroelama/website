# Monitoring (templates)

To be provisioned in the observability phase. Planned checks:

| Check               | Target                                             | Alert                                                                            |
| ------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| Uptime              | `https://web.example.org/health`                   | 2 consecutive failures                                                           |
| Uptime              | `https://admin.example.org/health`                 | 2 consecutive failures                                                           |
| Uptime              | `https://shop.example.org/`                        | 2 consecutive failures                                                           |
| Uptime              | `https://api.example.org/health`                   | 2 consecutive failures                                                           |
| Error rate          | `stderr.log` per app (cPanel), Sentry later        | new error type / spike                                                           |
| Security events     | log stream `security_event`                        | any `staff.role_changed`, `apikey.created`, `audit.revert`, login-failure spikes |
| Email               | bounce rate > 2%, complaint rate > 0.1%            |                                                                                  |
| Failed side effects | `email_log` / `zoom_requests` with status `failed` | any, daily digest                                                                |
| Cost                | GCP budget alerts                                  | 50% / 90% (never auto-disable billing)                                           |

`checks.example.json` is a vendor-neutral list for whichever uptime tool is chosen. web, admin and
the gateway answer `GET /health` with `{"status":"ok"}` and never touch the database; shop has no
health route yet, so its home page is checked.
