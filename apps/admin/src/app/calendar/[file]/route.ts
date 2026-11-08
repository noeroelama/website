import { connection } from "next/server";
import { calendar } from "@/server/wiring";

export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  await connection();
  const { file } = await params;
  return calendar().feed(file);
}
