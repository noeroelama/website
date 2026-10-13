import { AccessMessage } from "@/components/access-message";
import { requireAdminViewer } from "@/server/context";

// Login required: rendered at request time so a signed-out visitor gets a real 307 to the web
// sign-in page (a redirect inside a streamed <Suspense> would arrive as a 200).
export const instant = false;

export default async function DashboardPage() {
  const viewer = await requireAdminViewer("/");
  if (typeof viewer === "string") return <AccessMessage reason={viewer} />;
  return <h1>Dashboard</h1>;
}
