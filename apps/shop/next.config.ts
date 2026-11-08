import path from "node:path";
import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const standalone: NextConfig =
  process.env["NEXT_OUTPUT"] === "standalone"
    ? { output: "standalone", outputFileTracingRoot: path.resolve(import.meta.dirname, "../..") }
    : {};

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  cacheComponents: true,
  experimental: { authInterrupts: true },
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
  serverExternalPackages: ["firebase-admin", "mysql2"],
  ...standalone,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
