# Firebase configuration

Templates only. Nothing here is deployed automatically.

| File                               | Purpose                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `.firebaserc`                      | The one project (`default`). **Must match** `WEBSITE_FIREBASE_PROJECT_ID` in `packages/config/src/environments.ts`. |
| `firebase.json`                    | Rules and indexes paths.                                                                                            |
| `firestore.rules`, `storage.rules` | Deny-all for clients. All access is server-side via the Admin SDK.                                                  |

`firestore.indexes.json` holds the composite indexes the queries need (e.g. the admin Users list:
`roleIds` / `status` + `email` + `uid`). Deploy them with `firebase deploy --only firestore:indexes`
whenever the file changes.

Firebase emulators are not used: every app refuses to start when an emulator variable
(`FIREBASE_AUTH_EMULATOR_HOST`, `FIRESTORE_EMULATOR_HOST`, `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST`)
is set. Tests use in-memory adapters instead. Deploy rules explicitly:

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
```

Rate-limit counters expire automatically once a TTL policy exists (one time):

```bash
gcloud firestore fields ttls update expiresAt --collection-group=rateLimits --enable-ttl --project=ppidk-website-prod
# same for passkey challenges:
gcloud firestore fields ttls update expiresAt --collection-group=webauthnChallenges --enable-ttl --project=ppidk-website-prod
```

Authentication settings (Firebase console → Authentication):

- Sign-in providers: enable **Google** and **Email/Password**.
- Settings → **Email enumeration protection**: on. **Password policy**: minimum 8 characters.
- Settings → **Authorized domains**: add the web domain (and `localhost` for development).
- Templates: set the sender name and the password-reset / verification email text.
- Passkeys need `createCustomToken`: give the web service account a key, or the
  "Service Account Token Creator" role when using Workload Identity.

See `docs/environment.md` for the staging/production boundary and `docs/disaster-recovery.md` for backups.
