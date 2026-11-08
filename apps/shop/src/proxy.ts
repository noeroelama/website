import { NextResponse, type NextRequest } from "next/server";
import { guardRequest } from "@/server/request-guard";

export async function proxy(request: NextRequest) {
  const { blocked, headers } = await guardRequest(request);
  if (blocked) return blocked;
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|gif|webp|avif|svg|ico|css|js|map|txt|xml|woff2?)$).*)",
  ],
};
