import { connection } from "next/server";
import { whatsappWebhook } from "@/server/wiring";

export async function GET(request: Request) {
  await connection();
  return whatsappWebhook().verify(new URL(request.url));
}
export async function POST(request: Request) {
  return whatsappWebhook().receive(request);
}
