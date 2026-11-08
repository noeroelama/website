import { getAuditContext, getPrincipal } from "@/server/context";
import { incomingActions } from "@/server/wiring";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  return incomingActions().scanFile(id, await getPrincipal());
}

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return incomingActions().uploadScan(getPrincipal, getAuditContext)(id, request);
}
