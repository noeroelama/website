import path from "node:path";
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // A nonce-based Content-Security-Policy is added via proxy.ts in the next phase (docs/security.md).
];

// cPanel: `NEXT_OUTPUT=standalone` emits a self-contained server (docs/deployment.md#cpanel).
// Unset (`next dev`, `next start`) nothing changes. The tracing root is the monorepo root so the
// workspace packages are copied too.
const standalone: NextConfig =
  process.env["NEXT_OUTPUT"] === "standalone"
    ? { output: "standalone", outputFileTracingRoot: path.resolve(import.meta.dirname, "../..") }
    : {};

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Partial Prerendering: a static shell is prerendered at build; request-time parts stream in
  // behind <Suspense>. See docs/architecture.md#rendering.
  cacheComponents: true,
  // Enables forbidden()/unauthorized() and their 403/401 pages (src/app/{forbidden,unauthorized}.tsx).
  experimental: { authInterrupts: true },
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: [
    "@website/audit",
    "@website/auth",
    "@website/config",
    "@website/db",
    "@website/domain",
    "@website/email",
    "@website/observability",
    "@website/permissions",
    "@website/ui",
  ],
  serverExternalPackages: ["firebase-admin"],
  ...standalone,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
