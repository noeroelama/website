import { getPrincipal } from "@/server/context";
import { lpjFile } from "@/server/wiring";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return lpjFile()(id, await getPrincipal());
}
