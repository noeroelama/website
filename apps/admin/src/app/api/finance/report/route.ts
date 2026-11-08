import { connection } from "next/server";
import { getPrincipal } from "@/server/context";
import { financeActions } from "@/server/wiring";

export async function GET(request: Request) {
  await connection();
  return financeActions().reportFile(new URL(request.url), await getPrincipal());
}
