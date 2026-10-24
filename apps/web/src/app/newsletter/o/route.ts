import { connection } from "next/server";
import { newsletter } from "@/server/newsletter-wiring";

/** 1×1 transparent GIF. */
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

/** GET /newsletter/o?t=<signed> — the open pixel of a campaign e-mail (counted once per reader). */
export async function GET(request: Request) {
  await connection(); // per request, never prerendered at build
  await newsletter().trackOpen(new URL(request.url).searchParams.get("t") ?? "");
  return new Response(PIXEL, {
    headers: { "Content-Type": "image/gif", "Cache-Control": "private, no-store" },
  });
}
