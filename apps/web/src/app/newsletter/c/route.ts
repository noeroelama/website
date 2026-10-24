import { connection } from "next/server";
import { newsletter } from "@/server/newsletter-wiring";

/**
 * GET /newsletter/c?t=<signed> — a link in a campaign e-mail: counts the click, then redirects to
 * the address signed into the link (never to one taken from the query, so no open redirect).
 */
export async function GET(request: Request) {
  await connection(); // per request, never prerendered at build
  const url = await newsletter().trackClick(new URL(request.url).searchParams.get("t") ?? "");
  return new Response(null, {
    status: url ? 302 : 404,
    headers: { ...(url ? { Location: url } : {}), "Cache-Control": "private, no-store" },
  });
}
