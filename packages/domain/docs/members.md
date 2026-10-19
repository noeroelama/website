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

## Verification, data changes and graduation (B4, B5)

- Rules: `packages/domain/src/members/verification.ts`; Firestore
  `packages/db/src/firestore/member-profiles.ts` (`memberProfiles/{uid}` fields
  `verificationStatus`, `verifiedBy`, `verifiedAt`, `graduatedOn`, `graduationMarkedBy`,
  `chapterId`; requests in `profileChangeRequests/{uid}`); admin
  `apps/admin/src/server/members.ts` and the **Members** page (`members.verify`); web
  `apps/web/src/server/profile.ts` (`/account/profile`).
- Guarded fields (PPIDK §63): full name, gender, date of birth, PPI country, campus. Not
  verified yet: the member changes them at once, and each change is audited (actor `member`,
  restricted values redacted). A verifier — `members.verify` for the member's chapter, never
  their own data — verifies the profile. After that a change of guarded fields becomes a request
  (one pending per profile, the verified values stay until approved; other fields apply at
  once). Approve applies it (and moves the member's chapter when the country changed); reject
  keeps the verified values. Every decision is audited (module `members`, not revertible).
- Chapter isolation (§73): the queues are filtered by the viewer's chapters in the query, and
  every action checks `members.verify` against the member's chapter read on the server
  (`createGuardedAction` `resource` may load it). Birth date and gender show only with
  `members.pii` for that chapter.
- Graduation (§67): only the date is stored; `studyStatus` computes student / graduating
  (date ahead) / alumni. The member marks or corrects it at once; cancelling is allowed to a
  verifier (with a reason) or to the member for a mark they set themselves. The date is refused
  before the year of entry or more than 10 years ahead. Graduation never ends an appointment:
  graduated officers of the active period appear on the admin dashboard for `appointments.edit`.
- Not built yet: the student card (KTM) upload on the website (the private `ktm` image preset
  exists; the web upload route comes with the documents phase), and marking another member's
  graduation from the admin screen (the guarded action `setGraduation` exists).
- Tests: `tests/integration/profile-verification.test.ts`.

## Import from PPIDK (block J)

- Mapping: `packages/db/src/ppidk/people.ts` (pure, tested in `tests/unit/ppidk-import.test.ts`);
  script: `infrastructure/scripts/import-ppidk-people.mjs` (standard library only for the TSV;
  Firebase Admin; dry run unless `--apply`; writes `import-report.json` with counts and every
  skipped row). Ids come from PPIDK (`ppidk-<table>-<id>`; ROR campuses keep `{rorKey}_{country}`),
  so running it again writes the same documents.
- Accounts: matched by e-mail to an existing Firebase account (its roles are kept and the
  imported ones added), otherwise created as `ppidk-<id>` without a password — people sign in
  with Google or reset the password, and register passkeys again.
- Profiles are imported as answers but count as incomplete (the consent is not the current
  policy, and PPIDK did not ask e.g. the emergency contact): each member completes and agrees on
  the first visit (the profile gate). Verified PPIDK profiles stay verified and get the `member`
  role.
- Active appointments of the active period get their roles from `settings/appointmentRoles`
  (set it before importing). Manual PPIDK role assignments are NOT imported (roles are data
  here): the report lists them for the Users page. Chapters staff already added are reused by
  country; the import refuses to run when periods were already created here.

## Universities (A3)

- Master `universities/{id}` (`packages/domain/src/members/universities.ts`,
  `packages/db/src/firestore/universities.ts`): campuses from the ROR dump (`approved`, id
  `{rorKey}_{country}`) and campuses members propose (`pending`).
- Import (owner, once, and again when chapters are added):
  `infrastructure/scripts/import-ror-universities.mjs` reads the official ROR dump (CC0, from
  Zenodo — the ROR API pages are incomplete, PPIDK §7) for the countries of the active chapters;
  one row per country (§7b). Dry run unless `--apply`; safe to run again. It imports the domain
  code with Node type stripping (`--import ./infrastructure/scripts/ts-register.mjs`).
- Profile: the picker lists the approved campuses of the chosen PPI country (cached for minutes)
  plus the member's own pending proposals, filtered in the browser on the name and aliases.
  `memberProfiles/{uid}.universityId` points at the campus and `university` holds its name; a
  pick must be approved (or the member's own proposal) in the PPI country. Without a pick the
  typed name is kept (`universityId` null).
- "My campus is not listed" proposes one. Obvious duplicates are refused in the same country:
  the same `normalizeUniversityName` (deliberately conservative, PPIDK §6) of a listed or
  proposed campus, or of an alias of a listed one. ALL CAPS / lower case names are tidied.
- Review queue: admin **Universities** page (`universities.read` / `universities.edit`). Approve;
  merge into a listed campus of the same country (the proposal is kept as `rejected` with
  `mergedInto`, and every profile pointing at it moves to that campus); or reject with a reason
  (profiles lose the pick and choose again). Merge suggestions share a distinctive word
  (`mergeCandidates`). Audited (module `universities`), not revertible. At most 400 profiles per
  decision.
- Tests: `tests/unit/universities.test.ts`, `tests/integration/universities.test.ts`.

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
