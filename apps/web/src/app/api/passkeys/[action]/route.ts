import { passkeyRoutes } from "@/server/passkeys";

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const routes = passkeyRoutes();
  switch ((await context.params).action) {
    case "register-options":
      return routes.registerOptions(request);
    case "register-verify":
      return routes.registerVerify(request);
    case "login-options":
      return routes.loginOptions(request);
    case "login-verify":
      return routes.loginVerify(request);
    default:
      return new Response(null, { status: 404 });
  }
}
