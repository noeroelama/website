/**
 * Where to send the browser after sign-in (`/login?next=…`), without becoming an open redirect.
 * Allowed: a same-site path ("/account"), or an absolute URL whose origin is exactly one of our
 * apps (WEB_URL, ADMIN_URL, SHOP_URL). Everything else returns null.
 */
export function safeReturnUrl(
  value: string | null | undefined,
  allowedOrigins: readonly string[],
): string | null {
  if (!value || value.length > 2048) return null;

  // Relative path on the same site. "//host" and "/\host" are protocol-relative to browsers.
  if (value.startsWith("/")) {
    return value.startsWith("//") || value.startsWith("/\\") ? null : value;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const origins = new Set(
    allowedOrigins.flatMap((origin) => {
      try {
        return [new URL(origin).origin];
      } catch {
        return [];
      }
    }),
  );
  return origins.has(url.origin) ? url.href : null;
}

/**
 * The web sign-in page with the page to come back to. Every app sends a signed-out visitor of a
 * login-required page here (one session is shared by all apps, so they return signed in).
 */
export function signInUrl(webUrl: string, returnTo: string): string {
  return `${webUrl.replace(/\/+$/, "")}/login?next=${encodeURIComponent(returnTo)}`;
}
