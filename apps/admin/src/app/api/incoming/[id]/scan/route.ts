import { getAuditContext, getPrincipal } from "@/server/context";
import { incomingActions } from "@/server/wiring";

type Context = { params: Promise<{ id: string }> };

/** An incoming letter's scan (docs: packages/domain/docs/documents.md → Incoming letters). */
export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  return incomingActions().scanFile(id, await getPrincipal());
}

/** Upload the scan (PDF body, `?version=`, `x-file-name`). Same origin only (request guard). */
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return incomingActions().uploadScan(getPrincipal, getAuditContext)(id, request);
}
