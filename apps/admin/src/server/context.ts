import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { SESSION_COOKIE, signInUrl, type VerifiedIdentity } from "@website/auth";
import { createFirebaseIdentityProvider } from "@website/auth/firebase-admin";
import { isProfileComplete } from "@website/domain/members";
import {
  canAccessAdmin,
  canInSomeScope,
  type PagePermission,
  type Principal,
} from "@website/permissions";
import { resolveRequestId } from "@website/observability";
import { getAdminEnv, getAppUrls } from "./env";
import { adminStores } from "./stores";
import type { AuditContext } from "./guarded-action";
import { userDirectory } from "./user-directory";

/** The signed-in staff member: who they are (for display) and what they may do. */
export interface AdminViewer {
  readonly principal: Principal;
  readonly name: string | null;
  readonly email: string | null;
  /** The member profile is complete (B3). Until it is, pages send staff to the web profile page
   *  first and actions are refused. */
  readonly profileComplete: boolean;
}

/** Shared session cookie → Firebase verification (with revocation check). Once per request. */
const getIdentity = cache(async (): Promise<VerifiedIdentity | null> => {
  const cookie = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  const env = getAdminEnv();
  return createFirebaseIdentityProvider({
    appEnv: env.APP_ENV,
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY,
  }).verifySessionCookie(cookie);
});

/**
 * Resolves the current staff member on the server for every request:
 * session cookie → Firebase verification → user record + roles in Firestore.
 * Returns null unless the user holds a staff role (any admin-page permission).
 * Never trusts client state, token claims, URL params or payload role fields.
 */
export const getAdminViewer = cache(async (): Promise<AdminViewer | null> => {
  const identity = await getIdentity();
  if (!identity) return null;
  const [principal, profile] = await Promise.all([
    userDirectory().findPrincipalByUid(identity.uid),
    adminStores().memberProfiles.findByUserId(identity.uid),
  ]);
  if (!principal || !canAccessAdmin(principal)) return null;
  return {
    principal,
    name: identity.name ?? null,
    email: identity.email,
    profileComplete: isProfileComplete(profile),
  };
});

/** The principal alone, for createGuardedAction (none until the member profile is complete). */
export async function getPrincipal(): Promise<Principal | null> {
  const viewer = await getAdminViewer();
  return viewer?.profileComplete ? viewer.principal : null;
}

/** Second argument of createGuardedAction: the staff e-mail and request id for audit entries. */
export async function getAuditContext(): Promise<AuditContext> {
  const viewer = await getAdminViewer();
  return {
    actorEmail: viewer?.email ?? null,
    requestId: resolveRequestId((await headers()).get("x-request-id")),
    authTime: (await getIdentity())?.authTime ?? null,
  };
}

/**
 * For every login-required page. Not signed in → the web sign-in page, which brings the visitor
 * back to `path` with the shared session (without a session cookie, src/proxy.ts already sent a
 * real 307: a redirect from here is streamed as a 200 + client-side redirect). Signed in without
 * any staff role → the restricted page (`forbidden()`, src/app/forbidden.tsx). Staff without
 * `permission` in any scope (the page's `<page>.read`) → "no-access", so the page shows a message
 * inside the side panel. The page still filters its data by scope with `can()`. "signed-out"
 * is only returned when WEB_URL/ADMIN_URL are not configured (e.g. CI), so the page can show a
 * message instead.
 */
export async function requireAdminViewer(
  path: string,
  permission?: PagePermission,
): Promise<AdminViewer | "signed-out" | "no-access" | "profile"> {
  if (!(await getIdentity())) {
    const { WEB_URL, ADMIN_URL } = getAppUrls();
    if (WEB_URL && ADMIN_URL) redirect(signInUrl(WEB_URL, `${ADMIN_URL}${path}`));
    return "signed-out";
  }
  const viewer = await getAdminViewer();
  if (!viewer) forbidden();
  if (!viewer.profileComplete) {
    // Staff fill in their member profile on the website first, then come back here (B3).
    const { WEB_URL, ADMIN_URL } = getAppUrls();
    if (WEB_URL && ADMIN_URL) {
      redirect(`${WEB_URL}/account/profile?next=${encodeURIComponent(`${ADMIN_URL}${path}`)}`);
    }
    return "profile";
  }
  if (permission !== undefined && !canInSomeScope(viewer.principal, permission)) return "no-access";
  return viewer;
}

/** Web sign-in link that returns to `path` — shown when an action needs a fresh sign-in. */
export function signInAgainUrl(path: string): string | null {
  const { WEB_URL, ADMIN_URL } = getAppUrls();
  return WEB_URL && ADMIN_URL ? signInUrl(WEB_URL, `${ADMIN_URL}${path}`) : null;
}
