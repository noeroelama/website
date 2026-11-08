import { cronRoute } from "@/server/wiring";

export async function GET(request: Request, { params }: { params: Promise<{ job: string }> }) {
  const { job } = await params;
  return cronRoute()(job, request);
}
