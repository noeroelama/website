import { connection } from "next/server";
import { certificatePickupFile } from "@/server/wiring";

/** A holder's own certificate sheet from the website's pickup page (D5-P; signed 15-min link). */
export async function GET(request: Request) {
  // Per request only: never prerendered at build (it needs the secrets and the database).
  await connection();
  return certificatePickupFile()(new URL(request.url).searchParams.get("t"));
}
