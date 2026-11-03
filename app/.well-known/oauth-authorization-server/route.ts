import { createOAuthConfig, getAuthorizationServerMetadata } from "@/lib/tournament-builder/oauth";
export const runtime = "nodejs";
export function GET() {
  if (process.env.MCP_ENABLED !== "true" || !process.env.APP_ORIGIN) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json(getAuthorizationServerMetadata(createOAuthConfig(process.env.APP_ORIGIN)), { headers: { "Cache-Control": "no-store" } });
}
