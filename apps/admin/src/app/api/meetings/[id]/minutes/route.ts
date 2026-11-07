import { getPrincipal } from "@/server/context";
import { minutesFile } from "@/server/wiring";

/**
 * Minutes as PDF, rendered at download time; `?sheet=attendance` gives the attendance list
 * (docs: packages/domain/docs/meetings.md → Minutes).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sheet =
    new URL(request.url).searchParams.get("sheet") === "attendance" ? "attendance" : "minutes";
  return minutesFile()(id, await getPrincipal(), sheet);
}
