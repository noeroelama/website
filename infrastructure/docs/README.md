# Infrastructure docs

Infrastructure is described here and provisioned manually (or with Terraform later) — never
automatically by this repository. Start with:

- `../../docs/deployment.md` — deployment boundaries, environments, rollback
- `../../docs/environment.md` — environments and variables
- `../../docs/disaster-recovery.md` — backups and restore drills
- `../firebase/README.md`, `../monitoring/README.md`

## Provisioning checklist (one-time)

- [ ] One Firebase project `ppidk-website-prod` (Blaze plan) for every environment, owned by ≥2 people with MFA
- [ ] Separate service accounts per app role: `web-ro`, `admin-rw`, `shop-rw`, `gateway-rw` (least privilege)
- [ ] One JSON key per service account, stored only in that app's cPanel **Setup Node.js App** screen and the password manager; rotate when anyone leaves
- [ ] Deploy deny-all `firestore.rules` and `storage.rules`
- [ ] Firestore PITR + scheduled backups + delete protection (production)
- [ ] Separate backup project with a retention-locked bucket
- [ ] DomaiNesia cPanel: four Node.js apps, domains + AutoSSL, env vars per app, Cron Jobs (`../../docs/deployment.md`)
- [ ] Resend: verified sending subdomains, SPF/DKIM/DMARC
- [ ] Budget alerts on GCP
