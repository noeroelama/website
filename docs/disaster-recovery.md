# Backup & disaster recovery

## Targets (initial)

| Area        | RTO                            | RPO                                                       |
| ----------- | ------------------------------ | --------------------------------------------------------- |
| Public site | ~0 (static pages keep serving) | n/a                                                       |
| Admin       | 4 h                            | 24 h (nightly dump); less with more frequent dumps        |
| Shop        | 4 h                            | minutes; payment provider is source of truth for payments |
| Gateway     | 4 h                            | 24 h                                                      |

## MySQL (cPanel)

- **Nightly dump** with a cPanel Cron Job (outside every app folder, `chmod 600` credentials file):
  `mysqldump --defaults-extra-file=~/.config/ppidk/my.cnf --single-transaction --routines <db> | gzip > ~/backups/ppidk-$(date +\%F).sql.gz`,
  then delete dumps older than 30 days (`find ~/backups -name 'ppidk-*.sql.gz' -mtime +30 -delete`).
- **Off-server copy**: download the dumps weekly (or copy them to storage outside DomaiNesia).
  Copies on the same account do not survive a compromised cPanel login.
- DomaiNesia's own account backups (cPanel → Backup / JetBackup, if the plan has it) are a second
  line, not the plan.
- Restores go to a **new database** (cPanel → MySQL Databases), then `DATABASE_URL` is switched;
  practice the cutover.

## Files (`FILE_STORAGE_DIR`)

- Uploads are never overwritten (every upload has a new name) and records keep pointing to old
  files, so a revert within 14 days finds them.
- Include the folder in the nightly backup (`tar czf ~/backups/ppidk-files-$(date +\%F).tgz -C ~ ppidk-files`)
  and the weekly off-server copy.

## Scenarios

| Scenario                        | Response                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Accidental deletion             | App soft delete → undelete; else restore the last dump into a new DB and copy rows |
| Corrupted data (bug/migration)  | Restore the last dump into a new DB, copy back affected rows; audit `before` helps |
| Ransomware / account compromise | Restore from the off-server copy; rotate all credentials                           |
| Regional outage                 | Public site serves cache; restore/redeploy admin/shop if prolonged                 |
| Audit log loss                  | The off-server dumps are authoritative (hash chain shows gaps)                     |

## Restoration testing

Quarterly scripted drill: restore latest backup into staging, run integrity checks (counts,
hash chain), record duration. An untested backup does not count.
