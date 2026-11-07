# Preview database snapshot

`preview.sql` is a full dump of the local **preview** database (demo seed data)
used by the `web` app during development (see `apps/web/.env.local` →
`DATABASE_URL`). It exists so anyone (e.g. a reviewer previewing the site) can
restore the exact data the developer sees locally: chapters, events, galleries,
news content, the 55 org units and the active period.

It is **demo data only** — the user/audit/profile tables are empty, so it is
safe to commit to this public repository. It is a *snapshot*; regenerate it
whenever seeds change (script lives in `/tmp`; ask Claude to regenerate).

## Import

```bash
# with DATABASE_URL = mysql://<user>:<pass>@host:3306/preview
mysql -u <user> -p < target-database < preview.sql
```

The dump creates the database itself (`CREATE DATABASE IF NOT EXISTS preview`)
and sets `FOREIGN_KEY_CHECKS = 0` around the inserts, so a fresh or existing
`preview` database both work. Text is `utf8mb4`.

## Content (snapshot date: 2026-11-07)

| table           | rows |
|-----------------|------|
| chapters        | 18   |
| chapterSlugs    | 20   |
| content         | 18   |
| contentSlugs    | 18   |
| eventSlugs      | 129  |
| events          | 129  |
| galleries       | 44   |
| gallerySlugs    | 44   |
| orgUnits        | 55   |
| periods         | 1    |
| settings        | 1    |

All other tables exist but are empty (demo snapshot; admin users, audit logs
and member profiles are not part of the public dump).
