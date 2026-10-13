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
