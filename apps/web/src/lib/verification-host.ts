/**
 * Paths of public verification and certificate pickup: counted by the tighter rate limit
 * (20/minute per IP) so codes and e-mails cannot be tried in bulk.
 */
export const isVerificationPath = (path: string) =>
  path === "/verify" || path.startsWith("/verify/") || path === "/certificates";

/**
 * The verification host (VERIFICATION_HOST, e.g. verif.ppiasiania.id) answers the printed short
 * form: "/" → /verify, "/<CODE>" → /verify/<CODE>, "/<CODE>/pdf" → its download; anything else
 * → /verify. Null = not that host (no rewrite).
 */
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
