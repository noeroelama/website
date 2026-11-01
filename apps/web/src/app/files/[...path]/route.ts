import { fileRoutes } from "@/server/files-wiring";

/** Public uploads from the cPanel disk (apps/web/src/server/files.ts). */
export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return fileRoutes().publicFile(path);
}
