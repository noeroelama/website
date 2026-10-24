import { z } from "zod";
import { safeText } from "@website/security/validation";

/**
 * Letterhead of every letter (PPIDK `Kop`, settings `surat.*`): full-width images designed
 * outside (letterhead, footer, watermark) or, when there is no letterhead image, a text
 * letterhead with the emblem. Stored in `settings/letters` and FROZEN on each letter at issue,
 * so a new design never changes letters already issued.
 */
export const LETTERHEAD_FOLDER = "letters/letterhead/";

/** An uploaded letterhead image (preset `letterhead`); the path must be in its folder. */
export const LetterheadImageSchema = z
  .object({
    path: z
      .string()
      .max(300)
      .regex(/^letters\/letterhead\/[A-Za-z0-9_.-]+\.webp$/, "Upload the image again."),
    url: z.url().max(2000),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
export type LetterheadImage = z.infer<typeof LetterheadImageSchema>;

export const LetterheadSchema = z
  .object({
    parentName: safeText(120),
    mainName: safeText(120),
    address: safeText(240, { allowEmpty: true }).default(""),
    header: LetterheadImageSchema.nullable().default(null),
    footer: LetterheadImageSchema.nullable().default(null),
    watermark: LetterheadImageSchema.nullable().default(null),
    emblem: LetterheadImageSchema.nullable().default(null),
    /** Percent, 2-40: a darker watermark makes the letter hard to read. */
    watermarkOpacity: z.number().int().min(2).max(40).default(8),
    /** A small "Paraf" box above the footer. */
    initialsBox: z.boolean().default(false),
  })
  .strict();
export type Letterhead = z.infer<typeof LetterheadSchema>;

export const DEFAULT_LETTERHEAD: Letterhead = LetterheadSchema.parse({
  parentName: "PERHIMPUNAN PELAJAR INDONESIA DUNIA",
  mainName: "PPIDK ASIA-OSEANIA",
});

/** Dates on letters are written in the organisation's zone (WIB), in Indonesian. */
export const ORGANISATION_TIME_ZONE = "Asia/Jakarta";

/** "2026-11-02" or an instant → "2 November 2026". */
export function formatLetterDate(value: string | Date): string {
  const instant = typeof value === "string" ? new Date(`${value}T00:00:00Z`) : value;
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: typeof value === "string" ? "UTC" : ORGANISATION_TIME_ZONE,
  }).format(instant);
}

/**
 * The address printed as QR and text under a letter: `https://<VERIFICATION_HOST>/<CODE>` (the
 * short form PPIDK printed: verif.ppiasiania.id/8F3KM-QRTVW), else `<WEB_URL>/verify/<CODE>`.
 */
export function verificationUrl(
  code: string,
  where: { readonly host: string | null; readonly webUrl: string | null },
): { url: string; label: string } | null {
  const url = where.host
    ? `https://${where.host}/${code}`
    : where.webUrl
      ? `${where.webUrl.replace(/\/$/, "")}/verify/${code}`
      : null;
  return url ? { url, label: url.replace(/^https?:\/\//, "") } : null;
}
