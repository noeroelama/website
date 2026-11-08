import { connection } from "next/server";
import { newsletter } from "@/server/newsletter-wiring";

export async function GET(request: Request) {
  await connection();
  const url = await newsletter().trackClick(new URL(request.url).searchParams.get("t") ?? "");
  return new Response(null, {
    status: url ? 302 : 404,
    headers: { ...(url ? { Location: url } : {}), "Cache-Control": "private, no-store" },
  });
}
