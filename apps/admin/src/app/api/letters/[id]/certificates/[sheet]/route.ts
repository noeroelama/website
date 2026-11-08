import { getPrincipal } from "@/server/context";
import { certificateFile } from "@/server/wiring";

type Context = { params: Promise<{ id: string; sheet: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id, sheet } = await params;
  return certificateFile()(id, sheet, await getPrincipal());
}
