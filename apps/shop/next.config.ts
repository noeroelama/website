import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // A nonce-based Content-Security-Policy is added via proxy.ts in the next phase (docs/security.md).
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Partial Prerendering: a static shell is prerendered at build; request-time parts stream in
  // behind <Suspense>. See docs/architecture.md#rendering.
  cacheComponents: true,
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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
