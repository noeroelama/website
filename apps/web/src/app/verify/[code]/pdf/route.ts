import { verification } from "@/server/verification-wiring";

type Context = { params: Promise<{ code: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { code } = await params;
  return verification().download(code, null);
}

export async function POST(request: Request, { params }: Context) {
  const { code } = await params;
  const form = await request.formData();
  const name = form.get("name");
  return verification().download(code, typeof name === "string" ? name : null);
}
