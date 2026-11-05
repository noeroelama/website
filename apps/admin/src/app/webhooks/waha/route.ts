import { wahaWebhook } from "@/server/wiring";

/** WAHA webhooks (J3): satisfaction poll votes, HMAC-signed. */
export async function POST(request: Request) {
  return wahaWebhook()(request);
}
