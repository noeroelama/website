import { getPrincipal } from "@/server/context";
import { reportCardFile } from "@/server/wiring";

/** The period report card as PDF (`?period=`, default the active period), rendered on request. */
export async function GET(request: Request) {
  return reportCardFile()(new URL(request.url).searchParams.get("period"), await getPrincipal());
}
