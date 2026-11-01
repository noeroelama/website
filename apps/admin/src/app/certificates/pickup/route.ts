import { certificatePickupFile } from "@/server/wiring";

/** A holder's own certificate sheet from the website's pickup page (D5-P; signed 15-min link). */
export function GET(request: Request) {
  return certificatePickupFile()(new URL(request.url).searchParams.get("t"));
}
