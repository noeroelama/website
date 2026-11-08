export const isVerificationPath = (path: string) =>
  path === "/verify" || path.startsWith("/verify/") || path === "/certificates";

export function verificationRewrite(
  host: string | null,
  path: string,
  verificationHost: string | null,
): string | null {
  if (!verificationHost || host?.toLowerCase() !== verificationHost) return null;
  const match = /^\/([A-Za-z2-9]{5}-[A-Za-z2-9]{5})(\/pdf)?\/?$/.exec(path);
  if (match) return `/verify/${(match[1] as string).toUpperCase()}${match[2] ?? ""}`;
  return path.startsWith("/verify") ? null : "/verify";
}
