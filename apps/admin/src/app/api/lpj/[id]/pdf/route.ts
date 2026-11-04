import { getPrincipal } from "@/server/context";
import { lpjFile } from "@/server/wiring";

/** An LPJ as PDF, rendered at download time (docs: packages/domain/docs/programs.md → LPJ). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return lpjFile()(id, await getPrincipal());
}
