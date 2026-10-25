import { ownSignature } from "@/server/profile-wiring";
import { getSignedInUser } from "@/server/session";

const owner = async () => {
  const user = await getSignedInUser();
  return user && { uid: user.uid };
};

/** GET /api/account/signature — the signed-in person's own signature (preview only). */
export async function GET() {
  return ownSignature().view(await owner());
}

/** POST /api/account/signature?widthMm=&rotation= — replaces it (PNG or JPEG body, ≤ 2 MB). */
export async function POST(request: Request) {
  return ownSignature().upload(await owner(), request);
}
