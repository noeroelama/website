import { z } from "zod";
import { jsonError } from "@website/security";
import { SESSION_COOKIE, type IdentityProvider, type VerifiedIdentity } from "./session";

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
  cookieDomain?: string | undefined;
  onSignIn?: ((identity: VerifiedIdentity) => Promise<void>) | undefined;
}) {
  const maxAgeSeconds = options.maxAgeHours * 3600;
  const domain = options.cookieDomain;
  return {
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
        return jsonError("unauthenticated");
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
