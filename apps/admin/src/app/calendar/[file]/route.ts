import { connection } from "next/server";
import { calendar } from "@/server/wiring";

/** GET /calendar/<uid>.<signature>.ics (G2): a person's signed feed; outside /api, no session. */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  // Per request only: never prerendered at build (it needs the secrets and the database).
  await connection();
  const { file } = await params;
  return calendar().feed(file);
}
