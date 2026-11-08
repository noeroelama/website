import { fileRoutes } from "@/server/files-wiring";

export function GET(request: Request) {
  return fileRoutes().privateFile(new URL(request.url).searchParams.get("t"));
}
