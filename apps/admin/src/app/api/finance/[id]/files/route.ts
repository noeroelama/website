import { getAuditContext, getPrincipal } from "@/server/context";
import { financeActions } from "@/server/wiring";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  const path = new URL(request.url).searchParams.get("path") ?? "";
  return financeActions().readFile(id, path, await getPrincipal());
}

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return financeActions().uploadFile(getPrincipal, getAuditContext)(id, request);
}
