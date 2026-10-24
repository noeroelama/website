import { applying } from "@/server/recruitment-wiring";
import { getSignedInUser } from "@/server/session";

/**
 * POST /api/recruitment/{id}/portfolio — the signed-in applicant's own portfolio (PDF), with
 * `?question={questionId}` the answer of a file question, with `?pact` the signed integrity pact.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const [user, { id }] = await Promise.all([getSignedInUser(), context.params]);
  const query = new URL(request.url).searchParams;
  const target = query.has("pact") ? "pact" : query.get("question");
  return applying().uploadFile(user && { uid: user.uid }, id, target, request);
}
