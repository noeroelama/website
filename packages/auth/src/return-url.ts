const RELATIVE_BASE = "https://relative.invalid";
// eslint-disable-next-line no-control-regex -- matching control characters is the purpose
const UNSAFE_IN_PATH = /[\u0000-\u001F\u007F\\]/;

export function safeReturnUrl(
  value: string | null | undefined,
  allowedOrigins: readonly string[],
): string | null {
  if (!value || value.length > 2048) return null;

  if (value.startsWith("/")) {
    if (UNSAFE_IN_PATH.test(value)) return null;
    return new URL(value, RELATIVE_BASE).origin === RELATIVE_BASE ? value : null;
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

export function signInUrl(webUrl: string, returnTo: string): string {
  return `${webUrl.replace(/\/+$/, "")}/login?next=${encodeURIComponent(returnTo)}`;
}
