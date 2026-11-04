import { getPrincipal } from "@/server/context";
import { minutesFile } from "@/server/wiring";

/** Minutes as PDF, rendered at download time (docs: packages/domain/docs/meetings.md → Minutes). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return minutesFile()(id, await getPrincipal());
}
