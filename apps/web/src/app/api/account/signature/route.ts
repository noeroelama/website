import { ownSignature } from "@/server/profile-wiring";
import { getSignedInUser } from "@/server/session";

const owner = async () => {
  const user = await getSignedInUser();
  return user && { uid: user.uid };
};

export async function GET() {
  return ownSignature().view(await owner());
}

export async function POST(request: Request) {
  return ownSignature().upload(await owner(), request);
}
