export function safeReturnUrl(
  value: string | null | undefined,
  allowedOrigins: readonly string[],
): string | null {
  if (!value || value.length > 2048) return null;

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

export function signInUrl(webUrl: string, returnTo: string): string {
  return `${webUrl.replace(/\/+$/, "")}/login?next=${encodeURIComponent(returnTo)}`;
}
