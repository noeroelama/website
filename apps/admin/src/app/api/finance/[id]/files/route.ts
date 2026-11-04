import { getAuditContext, getPrincipal } from "@/server/context";
import { financeActions } from "@/server/wiring";

type Context = { params: Promise<{ id: string }> };

/** A request's document or proof of transfer (docs: packages/domain/docs/finance.md). */
export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  const path = new URL(request.url).searchParams.get("path") ?? "";
  return financeActions().readFile(id, path, await getPrincipal());
}

/**
 * Upload a document (`?kind=doc&version=`) or mark paid with the proof
 * (`?kind=proof&version=&amount=<minor units>`): PDF body, `x-file-name`. Same origin only.
 */
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return financeActions().uploadFile(getPrincipal, getAuditContext)(id, request);
}
