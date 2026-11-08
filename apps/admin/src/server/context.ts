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

export interface AdminViewer {
  readonly principal: Principal;
  readonly name: string | null;
  readonly email: string | null;
  readonly profileComplete: boolean;
}

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

export async function getPrincipal(): Promise<Principal | null> {
  const viewer = await getAdminViewer();
  return viewer?.profileComplete ? viewer.principal : null;
}

export async function getAuditContext(): Promise<AuditContext> {
  const viewer = await getAdminViewer();
  return {
    actorEmail: viewer?.email ?? null,
    requestId: resolveRequestId((await headers()).get("x-request-id")),
    authTime: (await getIdentity())?.authTime ?? null,
  };
}

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
    const { WEB_URL, ADMIN_URL } = getAppUrls();
    if (WEB_URL && ADMIN_URL) {
      redirect(`${WEB_URL}/account/profile?next=${encodeURIComponent(`${ADMIN_URL}${path}`)}`);
    }
    return "profile";
  }
  if (permission !== undefined && !canInSomeScope(viewer.principal, permission)) return "no-access";
  return viewer;
}

export function signInAgainUrl(path: string): string | null {
  const { WEB_URL, ADMIN_URL } = getAppUrls();
  return WEB_URL && ADMIN_URL ? signInUrl(WEB_URL, `${ADMIN_URL}${path}`) : null;
}
