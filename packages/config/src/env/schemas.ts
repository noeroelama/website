import { z } from "zod";
import { APP_ENVIRONMENTS } from "../environments";

/**
 * Reusable env fragments. Apps compose only the fragments they need, so an app
 * cannot accidentally receive (or require) another app's secrets.
 */
const nonEmpty = z.string().trim().min(1);
const optionalUrl = z.url().optional();

export const baseEnv = z.object({
  APP_ENV: z.enum(APP_ENVIRONMENTS),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

/** Firebase Admin SDK (server only): Authentication only. Credentials are optional so that
 * Workload Identity Federation / ADC can be used instead of a JSON key. */
export const firebaseAdminEnv = z.object({
  FIREBASE_PROJECT_ID: nonEmpty,
  FIREBASE_CLIENT_EMAIL: z.email().optional(),
  FIREBASE_PRIVATE_KEY: nonEmpty.optional(),
});

/** MySQL 8 on cPanel: all data except sign-in. Each app has its own MySQL user. */
export const databaseEnv = z.object({
  DATABASE_URL: nonEmpty.regex(/^mysql:\/\//, "mysql://user:password@localhost:3306/database"),
  /** Connections per server process (Passenger may run several processes per app). */
  DATABASE_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(20).default(5),
});

/**
 * Uploaded files on the cPanel disk (web and admin): an absolute folder outside every app folder,
 * e.g. /home/<user>/ppidk-files (C:\ppidk-files when developing on Windows). Empty = uploads are off.
 */
export const filesEnv = z.object({
  FILE_STORAGE_DIR: z
    .string()
    .trim()
    .regex(/^(\/|[A-Za-z]:[\\/])/, "an absolute path (/home/… or C:\\…)")
    .optional(),
});

/** Firebase web config. Public by design — never put secrets here. */
export const firebaseClientEnv = z.object({
  NEXT_PUBLIC_FIREBASE_API_KEY: nonEmpty,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: nonEmpty,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: nonEmpty,
  NEXT_PUBLIC_FIREBASE_APP_ID: nonEmpty,
});

export const sessionEnv = z.object({
  /** Session lifetime in hours (max 12 by policy). Use the same value in web, admin and shop. */
  SESSION_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(12).default(8),
  /**
   * Parent domain on which the ONE session cookie is shared by web, admin and shop
   * (e.g. `ppiasiania.id`). Empty = host-only (local development).
   */
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

/** Bearer secret for GET /cron/<job> (admin, cPanel Cron Jobs). Without it every cron call is 401. */
export const cronEnv = z.object({
  CRON_SECRET: nonEmpty.min(32).optional(),
});

/** HMAC key for per-IP rate-limit counters. Required in staging/production (checked at startup). */
export const rateLimitEnv = z.object({
  RATE_LIMIT_SECRET: nonEmpty.min(32).optional(),
});

/**
 * Outgoing messages (packages/domain/src/messaging). Every environment uses the live data, so
 * the default is `log` (record only). `live` sends in production; elsewhere only to the test
 * recipients (comma-separated e-mail addresses).
 */
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
    .pipe(z.array(z.email())),
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
});

/**
 * Newsletter (web sign-up, admin campaigns). SUBSCRIBER_HASH_SECRET turns an e-mail address into
 * the subscriber id — never rotate it. LINK_SIGNING_SECRET signs unsubscribe links. Both ≥ 32
 * characters and different per environment.
 */
export const newsletterEnv = z.object({
  SUBSCRIBER_HASH_SECRET: nonEmpty.min(32),
  LINK_SIGNING_SECRET: nonEmpty.min(32),
});

/**
 * Documents (letters, certificates). VERIFICATION_HOST is the extra domain of the web app that
 * answers printed codes (`verif.ppiasiania.id/<CODE>`, as PPIDK printed them); empty = the QR
 * points to `<WEB_URL>/verify/<CODE>`.
 */
export const documentsEnv = z.object({
  VERIFICATION_HOST: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "a host name such as verif.ppiasiania.id")
    .optional(),
});

/**
 * AES-256-GCM key for data only its owner may see (personal signatures): 32 random bytes,
 * base64. The SAME value on web (encrypts) and admin (decrypts for letters). Losing it makes
 * every stored signature unreadable; empty = signatures are off.
 */
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
  /** Pepper mixed into API-key hashes. Rotating it invalidates every key. */
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
