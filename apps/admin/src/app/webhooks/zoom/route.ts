import { zoomWebhook } from "@/server/wiring";

export async function POST(request: Request) {
  return zoomWebhook()(request);
}
