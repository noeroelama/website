import type { Metadata } from "next";
import { Suspense } from "react";
import { safeReturnUrl } from "@website/auth";
import { AppShell } from "@website/ui";
import { getAppUrls } from "@/server/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The form is in the prerendered shell; the optional `?next=` return target (e.g. the admin app,
// which shares the session cookie) is read at request time and validated on the server.
export default function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AppShell title="Sign in">
      <Suspense fallback={<LoginForm next={null} />}>
        <LoginWithReturn searchParams={searchParams} />
      </Suspense>
    </AppShell>
  );
}

async function LoginWithReturn({ searchParams }: { searchParams: SearchParams }) {
  const next = (await searchParams)["next"];
  if (typeof next !== "string") return <LoginForm next={null} />;
  const urls = getAppUrls();
  const allowed = [urls.WEB_URL, urls.ADMIN_URL, urls.SHOP_URL].filter(
    (url): url is string => url !== undefined,
  );
  return <LoginForm next={safeReturnUrl(next, allowed)} />;
}
