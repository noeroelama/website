import { getPrincipal } from "@/server/context";
import { letterFile } from "@/server/wiring";

/** A letter as PDF (docs: packages/domain/docs/documents.md → Letter PDF). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return letterFile()(id, await getPrincipal());
}
