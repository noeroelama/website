import { zoomWebhook } from "@/server/wiring";

/** Zoom Event Subscriptions (F2): signature checked, events about our meetings only. */
export async function POST(request: Request) {
  return zoomWebhook()(request);
}
