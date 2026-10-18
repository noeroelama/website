# Member profiles

Collected once per user in `memberProfiles/{uid}` and reused for event registrations
(registrations reference the user; they do not copy personal data).
Schema and validation: `packages/domain/src/members/profile.ts` (Zod, shared by every app).

| Field                        | Stored as                 | Validation                                                                                       | Class      |
| ---------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------ | ---------- |
| Full Name                    | `fullName`                | 1–200 chars                                                                                      | basic      |
| Gender                       | `gender`                  | `male` \| `female`                                                                               | restricted |
| Date of Birth                | `dateOfBirth`             | `YYYY-MM-DD`, age 15–100                                                                         | restricted |
| PPI Country                  | `ppiCountry`              | ISO 3166-1 alpha-2 (matches `countries`)                                                         | basic      |
| University                   | `university`              | 1–200 chars (reference list later)                                                               | basic      |
| Education Level              | `educationLevel`          | `diploma` (D3/D4), `bachelor` (S1), `master` (S2), `doctoral` (S3), `postdoctoral`, `non_degree` | basic      |
| Majors                       | `majors`                  | 1–3 entries                                                                                      | basic      |
| Year of Entry                | `yearOfEntry`             | 1950 … next year                                                                                 | basic      |
| Estimated Year of Graduation | `estimatedGraduationYear` | ≥ entry, ≤ entry + 15                                                                            | basic      |
| Detail Address Abroad        | `addressAbroad`           | line1, line2?, city, stateOrProvince?, postalCode?, countryCode                                  | restricted |
| Detail Address in Indonesia  | `addressIndonesia`        | line1, line2? (kelurahan/kecamatan), city, province, postalCode? (5 digits)                      | restricted |
| WhatsApp Number              | `whatsappNumber`          | E.164 (`+62…`), spaces/dashes stripped                                                           | restricted |
| Emergency Contact Number     | `emergencyContact`        | `phone` E.164 (required), `name`?, `relationship`?                                               | restricted |
| Timezone                     | `timezone`                | IANA (`Asia/Tokyo`)                                                                              | basic      |
| Email                        | `email`                   | Copied from the verified sign-in account; not typed by the user                                  | restricted |
| Consent                      | `consent`                 | privacy-policy version + timestamp, required                                                     | —          |

## Profile page and completeness gate (B3, A4)

- Members fill in `/account/profile` on the website (`apps/web/src/app/account/profile/…`,
  rules in `apps/web/src/server/profile.ts`). The owner always comes from the session (never the
  form); saving needs a verified e-mail, which is copied into the profile. A stale version is
  refused ("changed elsewhere").
- Consent: the form agrees to `PRIVACY_POLICY_VERSION` (= the date on the Privacy and Terms
  pages, `LEGAL_VERSION`). The first consent date is kept until the policy changes.
- `isProfileComplete(profile)`: a saved profile that agreed to the current policy. Until it is
  complete, admin pages send staff to `/account/profile?next=<admin page>` and admin actions are
  refused (`apps/admin/src/server/context.ts`), and event registration answers "complete your
  profile" (member-only). Bumping `PRIVACY_POLICY_VERSION` asks everyone to agree again.
- Saving also writes `users/{uid}.chapterId` (the active chapter whose `countryCode` is
  `ppiCountry`, or null) so chapter-scoped staff lists are one query; no personal data goes to
  `users`. Firestore: `packages/db/src/firestore/member-profiles.ts`.
- Address in Indonesia: province → regency/city pick-lists from
  `packages/domain/src/members/indonesia-regions.ts` (38 provinces, 514 regencies, Kepmendagri;
  generated once from the npm package `idn-area-data@4.0.1`, Open Database License — keep the
  attribution in that file). The names are stored as text; the schema is unchanged.
- Tests: `tests/integration/member-profile.test.ts`, `tests/security/app-guards.test.ts`,
  `tests/integration/web-registration.test.ts`.

## Access

- **The member**: reads/edits their own profile (`profile.read_own` / `profile.write_own`).
- **Staff with `members.read`**: basic fields only (`toBasicView`).
- **Staff with `members.pii`**: all fields — `chapter_admin` only for their chapter.
- **Exports**: `members.export` (only roles given it in the Roles page), logged as a security event.
- **Never**: the third-party gateway (lint-enforced), public pages, audit snapshots (restricted
  values are replaced with `[changed]`/`[unchanged]`; such changes are not revertible from the log).

## Personal data protection (UU PDP, Law 27/2022)

- Consent is recorded with the policy version; the privacy policy page must exist before launch.
- Collect only the fields above. Gender and date of birth are collected — confirm the purpose
  is stated in the privacy policy.
- Members can request a copy or deletion of their data (self-service export/delete in a later phase).
- Retention: define how long alumni profiles are kept after `estimatedGraduationYear`
  (proposal: 2 years, then delete or anonymize). **Decision needed.**
- Breach handling: notify affected members and the authority within 3×24 hours (UU PDP Art. 46).
