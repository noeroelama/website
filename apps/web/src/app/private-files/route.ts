import { fileRoutes } from "@/server/files-wiring";

/** A private file through a signed 15-minute link (apps/web/src/server/files.ts). */
export function GET(request: Request) {
  return fileRoutes().privateFile(new URL(request.url).searchParams.get("t"));
}
