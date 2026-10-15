import { getAuditContext, getPrincipal } from "@/server/context";
import { imageUploads } from "@/server/wiring";

/** Image upload (docs: packages/db/docs/files.md). Same origin only (request guard on /api/*). */
export async function POST(request: Request, { params }: { params: Promise<{ preset: string }> }) {
  const { preset } = await params;
  return imageUploads()(preset, request, getPrincipal, getAuditContext);
}
