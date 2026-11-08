import { applying } from "@/server/recruitment-wiring";
import { getSignedInUser } from "@/server/session";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const [user, { id }] = await Promise.all([getSignedInUser(), context.params]);
  const query = new URL(request.url).searchParams;
  const target = query.has("pact") ? "pact" : query.get("question");
  return applying().uploadFile(user && { uid: user.uid }, id, target, request);
}
