import { fileRoutes } from "@/server/files-wiring";

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return fileRoutes().publicFile(path);
}
