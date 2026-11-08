import { getPrincipal } from "@/server/context";
import { minutesFile } from "@/server/wiring";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sheet =
    new URL(request.url).searchParams.get("sheet") === "attendance" ? "attendance" : "minutes";
  return minutesFile()(id, await getPrincipal(), sheet);
}
