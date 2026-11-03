import { serveOAuth } from "@/lib/tournament-builder/oauth-server";
export const runtime = "nodejs";
export function POST(request: Request) { return serveOAuth(request, "revoke"); }
