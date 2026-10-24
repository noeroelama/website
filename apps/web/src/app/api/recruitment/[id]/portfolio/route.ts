import { applying } from "@/server/recruitment-wiring";
import { getSignedInUser } from "@/server/session";

/**
 * POST /api/recruitment/{id}/portfolio — the signed-in applicant's own portfolio (PDF), or with
 * `?question={questionId}` the answer of a file question.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const [user, { id }] = await Promise.all([getSignedInUser(), context.params]);
  const question = new URL(request.url).searchParams.get("question");
  return applying().uploadFile(user && { uid: user.uid }, id, question, request);
}
