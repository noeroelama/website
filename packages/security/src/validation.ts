import { z } from "zod";

const UNSAFE_CHARS =
  // eslint-disable-next-line no-control-regex -- matching control characters is the purpose
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;

export function sanitizeText(value: string, options: { multiline?: boolean } = {}): string {
  let text = value.normalize("NFC").replace(UNSAFE_CHARS, "");
  if (!options.multiline) text = text.replace(/[\r\n\t]+/g, " ");
  return text.replace(/[ \u00A0]{2,}/g, " ").trim();
}

export function safeText(max: number, options: { multiline?: boolean; allowEmpty?: boolean } = {}) {
  return z
    .string()
    .transform((value) => sanitizeText(value, options))
    .pipe(
      z
        .string()
        .min(options.allowEmpty ? 0 : 1)
        .max(max)
        .refine((value) => !/[<>]/.test(value), "HTML is not allowed"),
    );
}

export const safeId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, "Invalid id")
  .refine((id) => !/^__.*__$/.test(id), "Invalid id");
