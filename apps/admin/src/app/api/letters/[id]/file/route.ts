import { getAuditContext, getPrincipal } from "@/server/context";
import { letterActions } from "@/server/wiring";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return letterActions().uploadFile(getPrincipal, getAuditContext)(id, request);
}
