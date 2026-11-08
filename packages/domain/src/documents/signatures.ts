import { z } from "zod";

export const MAX_SIGNATURE_BYTES = 2 * 1024 * 1024;

export const SignatureSettingsSchema = z
  .object({
    widthMm: z.number().int().min(10).max(80).default(40),
    rotation: z.number().int().min(-180).max(180).default(0),
  })
  .strict();
export type SignatureSettings = z.infer<typeof SignatureSettingsSchema>;

export interface UserSignature extends SignatureSettings {
  readonly uid: string;
  readonly path: string;
  readonly type: "png" | "jpeg";
  readonly updatedAt: Date;
}

export const signaturePath = (uid: string, uuid: string) =>
  `members/signatures/${uid}_${uuid.replace(/-/g, "").slice(0, 8)}.enc`;
