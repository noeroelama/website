import { connection } from "next/server";
import { getPrincipal } from "@/server/context";
import { financeActions } from "@/server/wiring";

/**
 * The cash report of the active period (`?from=&to=` plain dates, `format=csv|pdf`), recomputed
 * on the server for finance.export (docs: packages/domain/docs/finance.md → Cash book).
 */
export async function GET(request: Request) {
  // Per request only: never prerendered at build (it needs the secrets and the database).
  await connection();
  return financeActions().reportFile(new URL(request.url), await getPrincipal());
}
