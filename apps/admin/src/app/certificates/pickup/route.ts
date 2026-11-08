import { connection } from "next/server";
import { certificatePickupFile } from "@/server/wiring";

export async function GET(request: Request) {
  await connection();
  return certificatePickupFile()(new URL(request.url).searchParams.get("t"));
}
