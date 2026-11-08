import { getAuditContext, getPrincipal } from "@/server/context";
import { imageUploads } from "@/server/wiring";

export async function POST(request: Request, { params }: { params: Promise<{ preset: string }> }) {
  const { preset } = await params;
  return imageUploads()(preset, request, getPrincipal, getAuditContext);
}
