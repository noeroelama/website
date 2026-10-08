# Firebase configuration

Templates only. Nothing here is deployed automatically.

| File                               | Purpose                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `.firebaserc`                      | The one project (`default`). **Must match** `WEBSITE_FIREBASE_PROJECT_ID` in `packages/config/src/environments.ts`. |
| `firebase.json`                    | Rules/indexes paths and local emulator ports.                                                                       |
| `firestore.rules`, `storage.rules` | Deny-all for clients. All access is server-side via the Admin SDK.                                                  |

Local emulators (optional, requires the Firebase CLI and Java):

```bash
cd infrastructure/firebase
firebase emulators:start --project demo-ppidk-website
```

`demo-*` project IDs never touch real cloud resources. Deploy rules explicitly and per alias:

```bash
firebase deploy --only firestore:rules,storage
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
