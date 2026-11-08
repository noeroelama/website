import { connection } from "next/server";
import { newsletter } from "@/server/newsletter-wiring";

const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

export async function GET(request: Request) {
  await connection();
  await newsletter().trackOpen(new URL(request.url).searchParams.get("t") ?? "");
  return new Response(PIXEL, {
    headers: { "Content-Type": "image/gif", "Cache-Control": "private, no-store" },
  });
}
