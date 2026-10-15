import { cronRoute } from "@/server/wiring";

/** cPanel Cron Jobs call GET /cron/<job> with the bearer secret (apps/admin/docs/cron.md). */
export async function GET(request: Request, { params }: { params: Promise<{ job: string }> }) {
  const { job } = await params;
  return cronRoute()(job, request);
}
