import { verification } from "@/server/verification-wiring";

type Context = { params: Promise<{ code: string }> };

/** The archived PDF of a letter whose content is public (D7). */
export async function GET(_request: Request, { params }: Context) {
  const { code } = await params;
  return verification().download(code, null);
}

/** Gated letters: the form posts the recipient's name again (checked again here). */
export async function POST(request: Request, { params }: Context) {
  const { code } = await params;
  const form = await request.formData();
  const name = form.get("name");
  return verification().download(code, typeof name === "string" ? name : null);
}
