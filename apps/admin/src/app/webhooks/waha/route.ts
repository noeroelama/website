import { wahaWebhook } from "@/server/wiring";

export async function POST(request: Request) {
  return wahaWebhook()(request);
}
