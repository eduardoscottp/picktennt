/** Native, un-intercepted browser forms against real OAuth HTML. Synthetic local state only. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:https";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { createOAuthConfig } from "../../lib/tournament-builder/oauth";
import { createOAuthServer, type OAuthStore } from "../../lib/tournament-builder/oauth-server";

async function main() {
const output = resolve("test-results/oauth-consent-origin");
mkdirSync(output, { recursive: true });
const key = resolve(output, "key.pem"), cert = resolve(output, "cert.pem");
const openssl = process.env.OPENSSL_PATH ?? (process.platform === "win32" ? "C:/Program Files/Git/mingw64/bin/openssl.exe" : "openssl");
const certificate = spawnSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { windowsHide: true, stdio: "pipe", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
assert.equal(certificate.status, 0, "Could not create local-only test certificate.");
const pending = new Map<string, Record<string, unknown>>();
const callback = "https://claude.ai/api/mcp/auth_callback";
let connectionRevoked = false;
const store: OAuthStore = async (action, payload) => {
  if (action === "rate_limit") return { allowed: true };
  if (action === "get_client") return { client_id: "local-client", client_name: "Synthetic Claude", redirect_uris: [callback] };
  if (action === "create_authorization") { const request = { ...payload, status: "pending" }; pending.set(String(payload.id), request); return request; }
  if (action === "get_authorization") return pending.get(String(payload.request_id))!;
  if (action === "approve_authorization") return { redirect_uri: callback, state: "synthetic-state" };
  if (action === "list_grants") return { grants: connectionRevoked ? [] : [{ id: "8c48c05c-eb12-4da4-9968-ed4efb785860", status: "active", client_name: "Synthetic Claude" }] };
  if (action === "revoke_grant") { connectionRevoked = true; return { revoked: true }; }
  throw new Error("Unexpected synthetic-store operation.");
};
let origin = "", mode = "control";
let service: ReturnType<typeof createOAuthServer>;
const posts: { flow: string; mode: string; origin_matches: boolean; origin_null: boolean; cookie_present: boolean; status: number }[] = [];
const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, async (request, response) => {
  try {
    if (request.url === "/local-callback") { response.writeHead(200, { "Content-Type": "text/html" }); response.end("<h1>Local callback</h1>"); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join("; ") : value);
    const flow = request.url?.startsWith("/oauth/connections") ? "connections" : "consent";
    const result = await service[flow === "connections" ? "connections" : "authorize"](new Request(`${origin}${request.url}`, { method: request.method, headers,
      ...(request.method === "POST" ? { body: Buffer.concat(chunks) } : {}) }));
    if (request.method === "GET" && mode === "control") result.headers.set("Referrer-Policy", "no-referrer");
    if (request.method === "POST") {
      posts.push({ flow, mode, origin_matches: headers.get("origin") === origin, origin_null: headers.get("origin") === "null", cookie_present: headers.has("cookie"), status: result.status });
      if (result.status === 303 && flow === "consent") {
        const target = new URL(result.headers.get("location")!);
        assert.equal(target.origin + target.pathname, callback);
        assert.equal(target.searchParams.get("state"), "synthetic-state");
        // Change only the verified outbound destination, after the real native POST reached the handler.
        result.headers.set("Location", `${origin}/local-callback`);
      }
    }
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch { response.writeHead(500); response.end("Synthetic test handler failed."); }
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  origin = `https://127.0.0.1:${address.port}`;
  service = createOAuthServer({ config: createOAuthConfig(origin), store, getUser: async () => ({ id: "synthetic-user" }) });
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
    args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const authorization = new URL(`${origin}/oauth/authorize`);
  authorization.search = new URLSearchParams({ response_type: "code", client_id: "local-client", redirect_uri: callback,
    resource: `${origin}/api/mcp`, state: "synthetic-state", code_challenge_method: "S256",
    code_challenge: createHash("sha256").update("a".repeat(43)).digest("base64url") }).toString();
  for (mode of ["control", "product"]) {
    await page.goto(authorization.href);
    await page.getByRole("button", { name: "Allow draft access", exact: true }).click();
    await page.waitForLoadState();
    const result = posts.at(-1)!;
    console.log(JSON.stringify(result));
    assert.equal(result.cookie_present, true);
    assert.equal(result.origin_null, mode === "control");
    assert.equal(result.origin_matches, mode === "product");
    assert.equal(result.status, mode === "control" ? 403 : 303);
  }
  for (mode of ["control", "product"]) {
    await page.goto(`${origin}/oauth/connections`);
    await page.getByRole("button", { name: "Revoke access", exact: true }).click();
    await page.waitForLoadState();
    const result = posts.at(-1)!;
    console.log(JSON.stringify(result));
    assert.equal(result.cookie_present, true);
    assert.equal(result.origin_null, mode === "control");
    assert.equal(result.origin_matches, mode === "product");
    assert.equal(result.status, mode === "control" ? 403 : 303);
    assert.equal(connectionRevoked, mode === "product");
  }
  await page.getByText("No active AI connections.", { exact: true }).waitFor();
  writeFileSync(resolve(output, "evidence.json"), JSON.stringify({ status: "passed", evidence: "Native Chrome form POST against real OAuth HTML with synthetic local storage; no Playwright request interception", cases: posts, completed_at: new Date().toISOString() }, null, 2));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise<void>((done) => server.close(() => done()));
}
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
