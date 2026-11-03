import { serveOAuth } from "@/lib/tournament-builder/oauth-server";
export const runtime = "nodejs";
export function GET(request: Request) { return serveOAuth(request, "authorize"); }
export function POST(request: Request) { return serveOAuth(request, "authorize"); }
