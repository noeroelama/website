import { connection } from "next/server";
import { whatsappWebhook } from "@/server/wiring";

/** Meta WhatsApp Cloud API webhook (C4): GET = verify-token handshake, POST = signed messages. */
export async function GET(request: Request) {
  // Per request only: never prerendered at build (it needs the secrets).
  await connection();
  return whatsappWebhook().verify(new URL(request.url));
}
export async function POST(request: Request) {
  return whatsappWebhook().receive(request);
}
