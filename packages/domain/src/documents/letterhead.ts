import { z } from "zod";
import { safeText } from "@website/security/validation";

export const LETTERHEAD_FOLDER = "letters/letterhead/";

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
    watermarkOpacity: z.number().int().min(2).max(40).default(8),
    initialsBox: z.boolean().default(false),
  })
  .strict();
export type Letterhead = z.infer<typeof LetterheadSchema>;

export const DEFAULT_LETTERHEAD: Letterhead = LetterheadSchema.parse({
  parentName: "PERHIMPUNAN PELAJAR INDONESIA DUNIA",
  mainName: "PPIDK ASIA-OSEANIA",
});

export const ORGANISATION_TIME_ZONE = "Asia/Jakarta";

export function formatLetterDate(value: string | Date): string {
  const instant = typeof value === "string" ? new Date(`${value}T00:00:00Z`) : value;
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: typeof value === "string" ? "UTC" : ORGANISATION_TIME_ZONE,
  }).format(instant);
}

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
