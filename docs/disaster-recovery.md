# Backup & disaster recovery

## Targets (initial)

| Area        | RTO                                | RPO                                                       |
| ----------- | ---------------------------------- | --------------------------------------------------------- |
| Public site | ~0 (static pages keep serving)     | n/a                                                       |
| Admin       | 4 h                                | minutes (PITR)                                            |
| Shop        | 4 h                                | minutes; payment provider is source of truth for payments |
| Gateway     | 4 h                                | minutes                                                   |

## Firestore

- Enable **point-in-time recovery** (7 days) and **delete protection** on production.
- **Scheduled backups**: daily, retention up to 14 weeks.
- **Off-project copy**: periodic managed export to a bucket in a _separate_ GCP project with
  Bucket Lock retention (30–90 days). Backups in the same project do not survive a compromised owner.
- Restores go to a **new database**; practice the cutover.

## Cloud Storage

- Soft delete ≥ 30 days (covers the 14-day revert window) or object versioning on media.
- Nightly transfer to the locked backup bucket. Dual-region bucket for media.

## Scenarios

| Scenario                        | Response                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Accidental deletion             | App soft delete → undelete; else PITR read of the document                         |
| Corrupted data (bug/migration)  | PITR restore into a new DB, copy back affected docs; audit `before` snapshots help |
| Ransomware / account compromise | Restore from the separate, locked project; rotate all credentials                  |
| Regional outage                 | Public site serves cache; restore/redeploy admin/shop if prolonged                 |
| Audit log loss                  | Locked off-project export is authoritative                                         |

## Restoration testing

Quarterly scripted drill: restore latest backup into staging, run integrity checks (counts,
hash chain), record duration. An untested backup does not count.
