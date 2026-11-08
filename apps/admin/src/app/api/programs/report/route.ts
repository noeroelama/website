import { getPrincipal } from "@/server/context";
import { reportCardFile } from "@/server/wiring";

export async function GET(request: Request) {
  return reportCardFile()(new URL(request.url).searchParams.get("period"), await getPrincipal());
}
