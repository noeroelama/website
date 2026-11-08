import { z } from "zod";
import { APP_ENVIRONMENTS } from "../environments";

const nonEmpty = z.string().trim().min(1);
const optionalUrl = z.url().optional();

export const baseEnv = z.object({
  APP_ENV: z.enum(APP_ENVIRONMENTS),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export const firebaseAdminEnv = z.object({
  FIREBASE_PROJECT_ID: nonEmpty,
  FIREBASE_CLIENT_EMAIL: z.email().optional(),
  FIREBASE_PRIVATE_KEY: nonEmpty.optional(),
});

export const databaseEnv = z.object({
  DATABASE_URL: nonEmpty.regex(/^mysql:\/\//, "mysql://user:password@localhost:3306/database"),
  DATABASE_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(20).default(5),
});

export const filesEnv = z.object({
  FILE_STORAGE_DIR: z
    .string()
    .trim()
    .regex(/^(\/|[A-Za-z]:[\\/])/, "an absolute path (/home/… or C:\\…)")
    .optional(),
});

export const firebaseClientEnv = z.object({
  NEXT_PUBLIC_FIREBASE_API_KEY: nonEmpty,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: nonEmpty,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: nonEmpty,
  NEXT_PUBLIC_FIREBASE_APP_ID: nonEmpty,
});

export const sessionEnv = z.object({
  SESSION_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(12).default(8),
  SESSION_COOKIE_DOMAIN: z
    .string()
    .trim()
    .toLowerCase()
    .transform((value) => value.replace(/^\./, ""))
    .pipe(
      z
        .string()
        .regex(
          /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
          "Plain parent domain, e.g. ppiasiania.id",
        ),
    )
    .optional(),
});

export const cronEnv = z.object({
  CRON_SECRET: nonEmpty.min(32).optional(),
});

export const rateLimitEnv = z.object({
  RATE_LIMIT_SECRET: nonEmpty.min(32).optional(),
});

export const messagingEnv = z.object({
  MESSAGING_MODE: z.enum(["log", "live"]).default("log"),
  MESSAGING_TEST_RECIPIENTS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    )
    .pipe(z.array(z.union([z.email(), z.string().regex(/^\+[1-9]\d{6,14}$/)]))),
});

export const wahaEnv = z.object({
  WAHA_BASE_URL: optionalUrl,
  WAHA_API_KEY: z.string().min(1).optional(),
  WAHA_SESSION: z.string().min(1).default("default"),
  WAHA_WEBHOOK_SECRET: z.string().min(16).optional(),
});

export const shortLinkEnv = z.object({
  GOPPI_BASE_URL: optionalUrl,
  GOPPI_API_KEY: z.string().min(1).optional(),
  SHORTLINK_API_KEY: z.string().min(1).optional(),
});

export const driveEnv = z.object({
  GOOGLE_DRIVE_CLIENT_EMAIL: z.email().optional(),
  GOOGLE_DRIVE_PRIVATE_KEY: z.string().min(1).optional(),
  GOOGLE_DRIVE_IMPERSONATE: z.email().optional(),
  GOOGLE_DRIVE_FOLDER_ID: z.string().min(1).optional(),
});

export const whatsappCloudEnv = z.object({
  WHATSAPP_CLOUD_PHONE_NUMBER_ID: z.string().min(1).optional(),
  WHATSAPP_CLOUD_TOKEN: z.string().min(1).optional(),
  WHATSAPP_CLOUD_APP_SECRET: z.string().min(1).optional(),
  WHATSAPP_CLOUD_VERIFY_TOKEN: z.string().min(16).optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
});

export const anthropicEnv = z.object({
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_MODEL: z.string().min(1).optional(),
});

export const resendEnv = z.object({
  RESEND_API_KEY: nonEmpty,
  EMAIL_FROM_TRANSACTIONAL: nonEmpty,
  EMAIL_FROM_NEWSLETTER: nonEmpty.optional(),
  RESEND_WEBHOOK_SECRET: nonEmpty.optional(),
});

export const captchaEnv = z.object({
  RECAPTCHA_SECRET_KEY: nonEmpty,
  RECAPTCHA_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.5),
});

export const paymentEnv = z.object({
  PAYMENT_PROVIDER: z.enum(["stripe", "xendit", "midtrans"]),
  PAYMENT_SECRET_KEY: nonEmpty,
  PAYMENT_WEBHOOK_SECRET: nonEmpty,
});

export const zoomEnv = z.object({
  ZOOM_ACCOUNT_ID: nonEmpty,
  ZOOM_CLIENT_ID: nonEmpty,
  ZOOM_CLIENT_SECRET: nonEmpty,
  ZOOM_HOST_USER: nonEmpty,
  ZOOM_WEBHOOK_SECRET_TOKEN: nonEmpty,
});

export const newsletterEnv = z.object({
  SUBSCRIBER_HASH_SECRET: nonEmpty.min(32),
  LINK_SIGNING_SECRET: nonEmpty.min(32),
});

export const documentsEnv = z.object({
  VERIFICATION_HOST: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "a host name such as verif.ppiasiania.id")
    .optional(),
});

export const fieldEncryptionEnv = z.object({
  FIELD_ENCRYPTION_KEY: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9+/]{43}=$/, "32 random bytes, base64 (44 characters)")
    .optional(),
});

export const calendarEnv = z.object({
  CALENDAR_FEED_SIGNING_SECRET: nonEmpty.min(32),
});

export const gatewayEnv = z.object({
  PORT: z.coerce.number().int().positive().default(3003),
  API_KEY_PEPPER: nonEmpty.min(32),
  GATEWAY_DB_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(20).default(5),
  GATEWAY_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
});

export const publicUrlsEnv = z.object({
  WEB_URL: optionalUrl,
  ADMIN_URL: optionalUrl,
  SHOP_URL: optionalUrl,
  API_URL: optionalUrl,
});
