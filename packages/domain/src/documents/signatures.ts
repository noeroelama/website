import { z } from "zod";

/**
 * Personal signatures (D4, PPIDK `TandaTanganPengguna`): one image per person, stored ENCRYPTED
 * in private Storage (a leaked signature could forge any document, forever). Only its owner sees
 * it; letters print it only on a desk that person has already signed. A missing or broken image
 * never blocks a letter: the name, the desk and the QR are still printed.
 */
export const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

export const SignatureSettingsSchema = z
  .object({
    /** Printed width in millimetres (the scan's resolution does not matter). */
    widthMm: z.number().int().min(10).max(80).default(40),
    /** Degrees clockwise, to straighten a skewed scan. */
    rotation: z.number().int().min(-180).max(180).default(0),
  })
  .strict();
export type SignatureSettings = z.infer<typeof SignatureSettingsSchema>;

export interface UserSignature extends SignatureSettings {
  readonly uid: string;
  /** Encrypted file (`encryptField` with FIELD_ENCRYPTION_KEY). */
  readonly path: string;
  readonly type: "png" | "jpeg";
  readonly updatedAt: Date;
}

/** A fresh name per upload (the old file is removed after the new one is stored). */
export const signaturePath = (uid: string, uuid: string) =>
  `members/signatures/${uid}_${uuid.replace(/-/g, "").slice(0, 8)}.enc`;
