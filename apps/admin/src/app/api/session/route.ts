import { sessionRoutes } from "@/server/session";

export function POST(request: Request) {
  return sessionRoutes().POST(request);
}

export function DELETE(request: Request) {
  return sessionRoutes().DELETE(request);
}
