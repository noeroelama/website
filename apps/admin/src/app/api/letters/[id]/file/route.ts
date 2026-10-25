import { getAuditContext, getPrincipal } from "@/server/context";
import { letterActions } from "@/server/wiring";

type Context = { params: Promise<{ id: string }> };

/**
 * Upload path (D3): the final PDF of a numbered letter (body = the PDF, `?version=`). Same
 * origin only (request guard). Docs: packages/domain/docs/documents.md → Upload path.
 */
export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return letterActions().uploadFile(getPrincipal, getAuditContext)(id, request);
}
