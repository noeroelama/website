import { z } from "zod";
import { jsonError } from "@website/security";
import { SESSION_COOKIE, type IdentityProvider, type VerifiedIdentity } from "./session";

/**
 * OAuth sign-in, server side. The browser signs in with Google through the Firebase client SDK
 * (OAuth 2.0 / OpenID Connect) and posts the resulting ID token here. The server verifies it with
 * Firebase and answers with an HttpOnly session cookie — the token itself is never stored in JS.
 *
 * The uid always comes from the verified token. The body accepts nothing else (no uid, no role).
 */
const SignInBody = z.object({ idToken: z.string().min(1).max(4096) }).strict();

function cookieHeader(value: string, maxAgeSeconds: number, domain: string | undefined): string {
  const scope = domain ? `; Domain=${domain}` : "";
  return `${SESSION_COOKIE}=${value}; Max-Age=${maxAgeSeconds}; Path=/${scope}; HttpOnly; Secure; SameSite=Lax`;
}

export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function createSessionRoutes(options: {
  identity: IdentityProvider;
  maxAgeHours: number;
  /** Parent domain shared by web, admin and shop (SESSION_COOKIE_DOMAIN); omit for host-only. */
  cookieDomain?: string | undefined;
  /**
   * Runs after the session cookie is created, with the identity read back from that verified
   * cookie (never from the body) — e.g. to create the user record on first sign-in. An error
   * fails the sign-in (no cookie is set).
   */
  onSignIn?: ((identity: VerifiedIdentity) => Promise<void>) | undefined;
}) {
  const maxAgeSeconds = options.maxAgeHours * 3600;
  const domain = options.cookieDomain;
  return {
    /** POST /api/session — sign in. */
    async POST(request: Request): Promise<Response> {
      const body = SignInBody.safeParse(await request.json().catch(() => null));
      if (!body.success) return jsonError("invalid_input");
      let cookie: string;
      try {
        cookie = await options.identity.createSessionCookie(
          body.data.idToken,
          maxAgeSeconds * 1000,
        );
      } catch {
        return jsonError("unauthenticated"); // reason (expired, revoked, forged) is not disclosed
      }
      if (options.onSignIn) {
        const identity = await options.identity.verifySessionCookie(cookie);
        if (!identity) return jsonError("unauthenticated");
        await options.onSignIn(identity);
      }
      return new Response(null, {
        status: 204,
        headers: {
          "Set-Cookie": cookieHeader(cookie, maxAgeSeconds, domain),
          "Cache-Control": "no-store",
        },
      });
    },

    /** DELETE /api/session — sign out of every app: revoke refresh tokens and clear the cookie. */
    async DELETE(request: Request): Promise<Response> {
      const cookie = readCookie(request, SESSION_COOKIE);
      const identity = cookie ? await options.identity.verifySessionCookie(cookie) : null;
      if (identity) await options.identity.revokeSessions(identity.uid);
      return new Response(null, {
        status: 204,
        headers: { "Set-Cookie": cookieHeader("", 0, domain), "Cache-Control": "no-store" },
      });
    },
  };
}
