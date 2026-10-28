/** Local-only browser evidence: actual Next UI + SQL, simulated Supabase Auth/REST. No external accounts. */
import assert from "node:assert/strict";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer as httpServer, request as httpRequest, type Server } from "node:http";
import { createServer as httpsServer } from "node:https";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { chromium, type BrowserContext } from "playwright";
import { storageDatabase, role, owner, player } from "../tournament-builder/helpers/storage-db";

const output = resolve("test-results/tournament-smoke");
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, "next.log"), "");
writeFileSync(resolve(output, "browser.log"), "");
const evidence: Record<string, unknown> = { evidence: "local Next browser + PGlite SQL; simulated Supabase Auth/REST; no Google or host OAuth verification", cases: [] };
const cases = evidence.cases as string[];
const secret = randomBytes(32);
const serviceKey = `test-service-${randomBytes(16).toString("hex")}`;
const nativeUsers = new Map([[owner, { id: owner, email: "owner@example.invalid", role: "authenticated", aud: "authenticated", app_metadata: { provider: "google", providers: ["google"] }, user_metadata: { given_name: "Organizer" }, created_at: new Date().toISOString() }], [player, { id: player, email: "player@example.invalid", role: "authenticated", aud: "authenticated", app_metadata: { provider: "google", providers: ["google"] }, user_metadata: { given_name: "Player" }, created_at: new Date().toISOString() }]]);
function jwt(userId: string) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 86400, iat: Math.floor(Date.now() / 1000) })).toString("base64url");
  return `${header}.${payload}.${createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url")}`;
}
function userFor(token: string) {
  try {
    const [header, payload, signature] = token.split(".");
    if (createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url") !== signature) return null;
    return nativeUsers.get(JSON.parse(Buffer.from(payload, "base64url").toString()).sub) ?? null;
  } catch { return null; }
}
async function listen(server: Server) {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address(); assert.ok(address && typeof address !== "string"); return address.port;
}
async function close(server: Server | undefined) {
  if (!server) return;
  server.closeAllConnections(); await new Promise<void>((done) => server.close(() => done()));
}
function stop(child: ChildProcess | undefined) {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  child.kill("SIGTERM");
  child.stdout?.destroy(); child.stderr?.destroy(); child.unref();
}
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function main() {
const db = await storageDatabase();
let backend: Server | undefined, proxy: Server | undefined, next: ChildProcess | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const receiver: { url?: string; method?: string; consentOriginMatches?: boolean } = {};
let queued: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>) { const task = queued.then(fn); queued = task.catch(() => undefined); return task; }
try {
  await db.exec(readFileSync("supabase/migrations/202610280002_tournament_connector_oauth.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/202610280008_tournament_connector_administration.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/202610280009_tournament_connector_owner_actions.sql", "utf8"));
  await db.query("update profiles set username=case when id=$1 then 'organizer' else 'player' end, first_name=case when id=$1 then 'Organizer' else 'Player' end,dupr_id='TEST' where id in ($1,$2)", [owner,player]);
  const profiles = (await db.query<Record<string, unknown>>("select * from profiles")).rows;
  backend = httpServer(async (request, response) => {
    const send = (body: unknown, status = 200) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(body)); };
    try {
      const url = new URL(request.url!, "http://127.0.0.1");
      const bearer = String(request.headers.authorization ?? "").replace(/^Bearer /i, "");
      if (url.pathname === "/auth/v1/user") { const user = userFor(bearer); send(user ?? { message: "Invalid test session" }, user ? 200 : 401); return; }
      if (url.pathname.startsWith("/rest/v1/rpc/")) {
        if (bearer !== serviceKey) { send({ message: "FORBIDDEN" }, 403); return; }
        const name = url.pathname.split("/").at(-1)!;
        if (!/^tb_[a-z_]+$/.test(name)) { send({ message: "FORBIDDEN" }, 403); return; }
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const args = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
        const keys = Object.keys(args); if (keys.some((key) => !/^p_[a-z_]+$/.test(key))) throw new Error("Invalid RPC argument");
        const result = await serialized(() => role(db, "service_role", owner, async () => {
          const values = Object.values(args).map((value) => value !== null && typeof value === "object" ? JSON.stringify(value) : value);
          const result = await db.query<{ result: unknown }>(`select public.${name}(${keys.map((key, index) => `${key} => $${index + 1}`).join(",")}) result`, values);
          return result.rows[0].result;
        }));
        send(result); return;
      }
      if (url.pathname === "/rest/v1/tournaments") {
        if (bearer !== serviceKey) { send({ message: "FORBIDDEN" }, 403); return; }
        const id = url.searchParams.get("id")?.replace(/^eq\./, "");
        if (!id || !/^[a-f0-9-]{36}$/i.test(id)) { send({ message: "Exact test tournament required" }, 400); return; }
        const found = await serialized(() => db.query("select engine_version,modular_state from tournaments where id=$1", [id]));
        send(request.headers.accept?.includes("object+json") ? found.rows[0] ?? null : found.rows); return;
      }
      if (url.pathname === "/rest/v1/profiles") {
        const user = userFor(bearer);
        if (!user && bearer !== serviceKey) { send({ message: "FORBIDDEN" }, 403); return; }
        const id = url.searchParams.get("id")?.replace(/^eq\./, "");
        const username = url.searchParams.get("username")?.replace(/^eq\./, "");
        const found = profiles.filter((profile) => (!id || profile.id === id) && (!username || profile.username === username));
        send(request.headers.accept?.includes("object+json") ? found[0] ?? null : found); return;
      }
      send({ message: "Unsupported test endpoint" }, 404);
    } catch (error) { send({ message: error instanceof Error ? error.message : "Test backend error" }, 400); }
  });
  const backendPort = await listen(backend);
  const keyPath = resolve(output, "key.pem"), certPath = resolve(output, "cert.pem");
  const openssl = process.env.OPENSSL_PATH ?? (process.platform === "win32" ? "C:/Program Files/Git/mingw64/bin/openssl.exe" : "openssl");
  const certificate = spawnSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { windowsHide: true, stdio: "pipe", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  if (certificate.status !== 0) throw new Error("Could not create the local-only HTTPS test certificate.");
  const reservation = httpServer(); const nextPort = await listen(reservation); await close(reservation);
  proxy = httpsServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (request, response) => {
    if (request.url?.startsWith("/local-test-callback?")) {
      receiver.url = request.url; receiver.method = request.method;
      response.writeHead(200, { "Content-Type": "text/html" }); response.end("<h1>Local callback intercepted</h1>"); return;
    }
    const forwarded = httpRequest({ hostname: "127.0.0.1", port: nextPort, path: request.url, method: request.method, headers: { ...request.headers, "x-forwarded-proto": "https" } }, (upstream) => {
      const headers = { ...upstream.headers };
      if (request.method === "POST" && request.url === "/oauth/authorize" && upstream.statusCode === 303) {
        const target = new URL(String(headers.location));
        assert.equal(target.origin + target.pathname, "https://claude.ai/api/mcp/auth_callback");
        receiver.consentOriginMatches = request.headers.origin === origin;
        const local = new URL("/local-test-callback", origin); local.search = target.search;
        headers.location = local.href;
      }
      response.writeHead(upstream.statusCode ?? 500, headers); upstream.pipe(response);
    });
    forwarded.on("error", () => { response.writeHead(502); response.end("Test Next server not ready"); }); request.pipe(forwarded);
  });
  proxy.on("upgrade", (request, socket, head) => {
    const upgrade = httpRequest({ hostname: "127.0.0.1", port: nextPort, path: request.url, method: request.method, headers: { ...request.headers, "x-forwarded-proto": "https" } });
    upgrade.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(upstreamResponse.headers).map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n`);
      if (head.length) upstreamSocket.write(head); if (upstreamHead.length) socket.write(upstreamHead);
      upstreamSocket.pipe(socket); socket.pipe(upstreamSocket);
      socket.on("error", () => upstreamSocket.destroy()); upstreamSocket.on("error", () => socket.destroy());
    });
    upgrade.on("error", () => socket.destroy()); upgrade.end();
  });
  const origin = `https://127.0.0.1:${await listen(proxy)}`;
  const guardPath = resolve(output, "localhost-fetch-guard.cjs");
  const guardOptionPath = guardPath.replaceAll("\\", "/");
  writeFileSync(guardPath, `const original=globalThis.fetch;globalThis.fetch=function(input,options){const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw new Error('Smoke test blocked a non-local fetch');return original(input,options)};`);
  next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", String(nextPort)], { windowsHide: true, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${backendPort}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon", SUPABASE_SERVICE_ROLE_KEY: serviceKey, APP_ORIGIN: origin, TOURNAMENT_BUILDER_ENABLED: "true", MCP_ENABLED: "true", NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require "${guardOptionPath}"`.trim() }, stdio: ["ignore", "pipe", "pipe"] });
  next.stdout?.on("data", (chunk) => appendFileSync(resolve(output, "next.log"), chunk)); next.stderr?.on("data", (chunk) => appendFileSync(resolve(output, "next.log"), chunk));
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"] });
  const probe = await browser.newContext({ ignoreHTTPSErrors: true });
  let started = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    if (next.exitCode !== null) throw new Error("Test Next server exited. See test-results/tournament-smoke/next.log.");
    try { const result = await probe.request.get(`${origin}/.well-known/oauth-authorization-server`, { timeout: 2000 }); if (result.status() === 200) { started = true; break; } }
    catch (error) { if (attempt === 0) appendFileSync(resolve(output, "next.log"), `\nProbe: ${error instanceof Error ? error.message : "local request failed"}\n`); }
    await delay(500);
  }
  await probe.close(); if (!started) throw new Error("Test Next server did not become ready.");
  async function account(userId: string): Promise<BrowserContext> {
    const context = await browser!.newContext({ ignoreHTTPSErrors: true, timezoneId: "America/New_York", viewport: { width: 1280, height: 900 } });
    await context.route("**/*", async (route) => { const target = new URL(route.request().url()); if (target.hostname !== "127.0.0.1") await route.abort(); else await route.continue(); });
    const session = { access_token: jwt(userId), refresh_token: "test-refresh-unused", token_type: "bearer", expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: nativeUsers.get(userId) };
    await context.addCookies([{ name: "sb-127-auth-token", value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`, url: origin, secure: true, httpOnly: false, sameSite: "Lax" }]);
    return context;
  }
  const organizer = await account(owner), opponent = await account(player);
  const page = await organizer.newPage(), other = await opponent.newPage();
  for (const current of [page, other]) {
    current.on("pageerror", (error) => appendFileSync(resolve(output, "browser.log"), `PAGEERROR ${error.message}\n`));
    current.on("console", (message) => { if (message.type() === "error") appendFileSync(resolve(output, "browser.log"), `CONSOLE ${message.text()}\n`); });
    current.on("requestfailed", (request) => appendFileSync(resolve(output, "browser.log"), `FAILED ${new URL(request.url()).pathname}: ${request.failure()?.errorText}\n`));
  }
  page.setDefaultTimeout(30000); other.setDefaultTimeout(30000);
  await page.goto(`${origin}/tournaments/build`, { timeout: 90000 });
  await page.getByLabel("Tournament name", { exact: true }).fill("Local two-player smoke");
  await page.getByLabel("Venue", { exact: true }).fill("Local test courts");
  await page.locator("select[name=admission]").selectOption("open");
  await page.getByLabel("Minimum entries", { exact: true }).fill("2"); await page.getByLabel("Maximum entries", { exact: true }).fill("2");
  await page.getByLabel("Courts", { exact: true }).fill("1"); await page.locator("input[name=organizer_plays]").check();
  const day = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await page.getByLabel("Starts", { exact: true }).fill(`${day}T09:00`); await page.getByLabel("Expected finish", { exact: true }).fill(`${day}T15:00`); await page.getByLabel("Registration deadline", { exact: true }).fill(`${day}T08:00`);
  await page.getByRole("button", { name: "Create draft and review", exact: true }).click();
  await page.waitForURL(/\/tournaments\/[a-f0-9-]+\/builder$/, { timeout: 60000 });
  const tournamentId = new URL(page.url()).pathname.split("/")[2];
  await page.getByLabel("I reviewed these rules, the format, and the schedule.", { exact: true }).check();
  await page.getByRole("button", { name: "Approve rules and open registration", exact: true }).click();
  await page.waitForURL(new RegExp(`/tournaments/${tournamentId}$`), { timeout: 60000 });
  await page.getByRole("heading", { name: "Published rules", exact: true }).waitFor();
  await page.goto(`${origin}/tournaments/${tournamentId}/builder`);
  await page.waitForURL(new RegExp(`/tournaments/${tournamentId}$`));
  assert.equal(await page.getByRole("heading", { name: "Matches", exact: true }).count(), 0);
  cases.push("Website creates and owner publishes an exact reviewed definition; published builder bookmark converges on Overview without a loop");
  async function join(current: typeof page, name: string) {
    await current.getByLabel("Your entry name", { exact: true }).fill(name);
    await current.getByLabel("I accept the published rules above and consent to this entry.", { exact: true }).check();
    await current.getByRole("button", { name: "Request my entry", exact: true }).click();
    await current.getByText(`${name} · Your entry`, { exact: true }).waitFor();
  }
  await join(page, "Organizer entry");
  await other.goto(`${origin}/tournaments/${tournamentId}`, { timeout: 60000 }); await join(other, "Opponent entry");
  await page.getByRole("button", { name: "Refresh", exact: true }).click(); await page.getByText("2 approved of 2 available entries.", { exact: true }).waitFor();
  cases.push("Two independent browser accounts consent and enroll separately");
  await other.goto(`${origin}/tournaments/${tournamentId}/admin`);
  assert.equal(await other.getByRole("heading", { name: "Tournament administration", exact: true }).count(), 0);
  assert.equal(await other.getByRole("button", { name: "Close registration", exact: true }).count(), 0);
  cases.push("Ordinary participant cannot open the server-gated Admin view");
  await page.goto(`${origin}/tournaments/${tournamentId}/admin`);
  await page.getByRole("heading", { name: "Tournament administration", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Add guest entry", exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Guest player name", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "Close registration", exact: true }).click();
  await page.getByLabel("I reviewed the current 2 approved entries, their players, and how they were registered.", { exact: true }).check();
  await page.getByRole("button", { name: "Lock reviewed roster and generate matches", exact: true }).click();
  const matchGenerationStarted = page.waitForResponse((response) => response.url().includes("commands?command=startTournament") && response.status() === 200);
  await page.getByRole("button", { name: "Start tournament", exact: true }).click();
  await matchGenerationStarted;
  await page.goto(`${origin}/tournaments/${tournamentId}/matches`);
  await page.getByRole("heading", { name: "Matches", exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Published rules", exact: true }).count(), 0);
  cases.push("Admin lifecycle controls and Matches scoring render on their distinct normal routes");
  assert.equal(await page.getByRole("button", { name: "Start match", exact: true }).count(), 0);
  const scores = page.locator("#matches input[type=number]"); await scores.nth(0).fill("11"); await scores.nth(1).fill("0");
  assert.equal(await page.getByRole("button", { name: "Submit provisional score", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Save & Validate", exact: true }).isEnabled(), true);
  cases.push("Administrator can save a scheduled game directly without Start, typed reason or competing provisional action");
  await other.goto(`${origin}/tournaments/${tournamentId}/matches`);
  const playerScores = other.locator("#matches input[type=number]"); await playerScores.nth(0).fill("11"); await playerScores.nth(1).fill("0");
  await other.getByRole("button", { name: "Submit provisional score", exact: true }).click();
  await other.getByText("Provisional result. The opposing entry must confirm, or an administrator must attest with a reason.", { exact: true }).waitFor();
  await page.reload();
  await page.getByLabel("Validation note (optional)", { exact: true }).fill("");
  assert.equal(await page.getByRole("button", { name: "Validate saved score", exact: true }).isEnabled(), true);
  let interrupted = false;
  await page.route("**/api/tournament-builder/*/commands?command=attestScore", async (route) => {
    if (interrupted) { await route.continue(); return; }
    interrupted = true;
    assert.equal(route.request().postDataJSON().data.reason, "Administrator validated the entered score.");
    const committed = await route.fetch(); assert.equal(committed.status(), 200);
    await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ message: "Simulated interrupted response" }) });
  });
  await page.getByRole("button", { name: "Validate saved score", exact: true }).click();
  await page.getByRole("button", { name: "Check saved action", exact: true }).click();
  await page.getByText("Edit score · review correction impact", { exact: true }).waitFor();
  cases.push("Administrator validates a saved player score with automatic audit note; interrupted response recovers without duplicate command");
  await other.goto(`${origin}/tournaments/${tournamentId}/leaderboard`);
  await other.locator("#placements ol li").first().waitFor(); assert.equal(await other.locator("#placements ol li").count(), 2);
  cases.push("Administrator validation advances the tournament and final first/second placements render");
  const clientResponse = await organizer.request.post(`${origin}/oauth/register`, { data: { client_name: "Local Claude connector", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], grant_types: ["authorization_code", "refresh_token"] } });
  assert.equal(clientResponse.status(), 201); const client = await clientResponse.json();
  const verifier = randomBytes(32).toString("base64url");
  const authorization = new URL(`${origin}/oauth/authorize`); authorization.search = new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", resource: `${origin}/api/mcp`, scope: "tournaments:draft", state: "local-state", code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") }).toString();
  let code = "";
  // The local HTTPS proxy rewrites only the verified outbound callback after the
  // native browser POST reaches Next. Never route.fetch consent: it masks Origin.
  await page.goto(authorization.href); await page.getByRole("button", { name: "Allow draft access", exact: true }).click(); await page.getByRole("heading", { name: "Local callback intercepted", exact: true }).waitFor();
  const callback = new URL(receiver.url!, origin); assert.equal(callback.searchParams.get("state"), "local-state"); assert.equal(callback.searchParams.get("iss"), origin); assert.equal(receiver.method, "GET"); code = callback.searchParams.get("code") ?? ""; assert.ok(code);
  assert.equal(receiver.consentOriginMatches, true);
  const tokenResponse = await organizer.request.post(`${origin}/oauth/token`, { form: { grant_type: "authorization_code", client_id: client.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", resource: `${origin}/api/mcp`, code, code_verifier: verifier } });
  assert.equal(tokenResponse.status(), 200); const tokens = await tokenResponse.json(); assert.match(tokens.access_token, /^[A-Za-z0-9_-]{43}$/);
  await page.goto(`${origin}/oauth/connections`); await page.getByRole("button", { name: "Revoke access", exact: true }).click(); await page.getByText("No active AI connections.", { exact: true }).waitFor();
  const revoked = await organizer.request.post(`${origin}/oauth/token`, { form: { grant_type: "refresh_token", client_id: client.client_id, refresh_token: tokens.refresh_token } }); assert.equal(revoked.status(), 400);
  cases.push("Browser OAuth consent uses original native account, 303 GET callback, isolated opaque token and native revocation");
  const adminVerifier = randomBytes(32).toString("base64url");
  const adminAuthorization = new URL(authorization);
  adminAuthorization.searchParams.set("scope", "tournaments:admin");
  adminAuthorization.searchParams.set("state", "local-admin-state");
  adminAuthorization.searchParams.set("code_challenge", createHash("sha256").update(adminVerifier).digest("base64url"));
  await page.goto(adminAuthorization.href);
  await page.getByRole("button", { name: "Allow tournament administration", exact: true }).click();
  await page.getByRole("heading", { name: "Local callback intercepted", exact: true }).waitFor();
  const adminCallback = new URL(receiver.url!, origin);
  assert.equal(adminCallback.searchParams.get("state"), "local-admin-state");
  assert.equal(adminCallback.searchParams.get("iss"), origin); assert.equal(receiver.consentOriginMatches, true);
  const adminCode = adminCallback.searchParams.get("code"); assert.ok(adminCode);
  const adminTokenResponse = await organizer.request.post(`${origin}/oauth/token`, { form: { grant_type: "authorization_code", client_id: client.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", resource: `${origin}/api/mcp`, code: adminCode, code_verifier: adminVerifier } });
  assert.equal(adminTokenResponse.status(), 200);
  const adminTokens = await adminTokenResponse.json();
  assert.equal(adminTokens.scope, "tournaments:admin");
  assert.ok(typeof adminTokens.access_token === "string" && /^[A-Za-z0-9_-]{43}$/.test(adminTokens.access_token));
  const connector = await browser.newContext({ ignoreHTTPSErrors: true });
  let rpcId = 0;
  async function rpc(method: string, params: Record<string, unknown>, token = adminTokens.access_token) {
    const answer = await connector.request.post(`${origin}/api/mcp`, { headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" }, data: { jsonrpc: "2.0", id: ++rpcId, method, params } });
    assert.equal(answer.status(), 200);
    const body = await answer.json(); assert.ok(!body.error, "MCP protocol request failed");
    return body.result;
  }
  async function adminTool(name: string, args: Record<string, unknown>) {
    const result = await rpc("tools/call", { name, arguments: args });
    assert.ok(!result.isError, `MCP tool ${name} failed`);
    return JSON.parse(result.content.find((item: { type: string }) => item.type === "text").text);
  }
  const tools = await rpc("tools/list", {});
  assert.ok(tools.tools.some((tool: { name: string }) => tool.name === "admin_register_players"));
  assert.ok(tools.tools.some((tool: { name: string }) => tool.name === "admin_save_result"));
  assert.ok(tools.tools.every((tool: { name: string }) => !tool.name.startsWith("owner_")));
  const completedViaMcp = await adminTool("admin_get_tournament", { tournament_id: tournamentId });
  assert.equal(completedViaMcp.event.id, tournamentId); assert.equal(completedViaMcp.event.modular_state, "completed");
  assert.equal(completedViaMcp.caller_role, "owner");
  cases.push("Same OAuth client explicitly reconnects with native administrator consent; isolated bearer-only HTTP MCP lists admin tools and reads the completed tournament");
  const accountsBefore = Number((await db.query<{ n: number }>("select count(*) n from auth.users")).rows[0].n);
  const completed = await (await organizer.request.get(`${origin}/api/tournament-builder/${tournamentId}`)).json();
  const registeredDefinition = structuredClone(completed.snapshot.definitions.find((row: { id: string }) => row.id === completed.snapshot.event.definition_id).definition);
  registeredDefinition.event.name = "Local existing-account registration";
  const registeredDraftResponse = await organizer.request.post(`${origin}/api/tournament-builder/drafts`, { headers: { Origin: origin }, data: { operation_id: randomUUID(), data: { definition: registeredDefinition } } });
  assert.equal(registeredDraftResponse.status(), 201);
  const registeredEvent = (await registeredDraftResponse.json()).tournament_id;
  await page.goto(`${origin}/tournaments/${registeredEvent}/builder`);
  await page.getByLabel("I reviewed these rules, the format, and the schedule.", { exact: true }).check();
  await page.getByRole("button", { name: "Approve rules and open registration", exact: true }).click();
  await page.waitForURL(url => url.pathname === `/tournaments/${registeredEvent}`);
  await page.goto(`${origin}/tournaments/${registeredEvent}/admin`);
  assert.equal(await page.getByRole("button", { name: "Find registered players", exact: true }).isEnabled(), false);
  assert.equal(await page.getByRole("button", { name: "Enroll registered entry", exact: true }).isEnabled(), false);
  for (const [index, username] of ["organizer", "player"].entries()) {
    await page.getByLabel("Player’s Picktennt username", { exact: true }).fill(username);
    await page.getByRole("button", { name: "Find registered players", exact: true }).click();
    await page.getByText(`Accounts found: ${username === "organizer" ? "Organizer" : "Player"}`, { exact: true }).waitFor();
    await page.getByLabel("Entry name", { exact: true }).fill(" ");
    assert.equal(await page.getByRole("button", { name: "Enroll registered entry", exact: true }).isEnabled(), false);
    await page.getByLabel("Entry name", { exact: true }).fill(`Registered ${username}`);
    await page.getByRole("button", { name: "Enroll registered entry", exact: true }).click();
    await page.getByText(`${index + 1} approved of 2 available entries.`, { exact: true }).waitFor();
    if (index === 0) await page.getByText("One of these accounts already has an entry in this tournament.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Enroll registered entry", exact: true }).isEnabled(), false);
  }
  await page.getByText("All available entries are filled.", { exact: true }).waitFor();
  assert.equal(await page.getByText("Administrator enrolled · Picktennt account", { exact: true }).count(), 2);
  const admitted = (await db.query<{ user_id: string; admission_source: string; consented_at: null; consented_definition_id: null }>("select user_id,admission_source,consented_at,consented_definition_id from team_members where tournament_id=$1", [registeredEvent])).rows;
  assert.deepEqual(new Set(admitted.map(member => member.user_id)), new Set([owner, player]));
  assert.ok(admitted.every(member => member.admission_source === "administrator" && member.consented_at === null && member.consented_definition_id === null));
  assert.equal(Number((await db.query<{ n: number }>("select count(*) n from auth.users")).rows[0].n), accountsBefore);
  await other.goto(`${origin}/tournaments/${registeredEvent}`);
  assert.equal(await other.getByRole("heading", { name: "Join as a player", exact: true }).count(), 0);
  assert.equal(await other.getByRole("button", { name: /^Accept invitation/ }).count(), 0);
  assert.equal(await other.getByText("0/1 accepted", { exact: true }).count(), 0);
  await page.screenshot({ path: resolve(output, "registered-account-roster.png"), fullPage: true });
  cases.push("Administrator resolves existing usernames and enrolls two real-profile identities without creating accounts or personal consent; duplicates, blank entry names and capacity are disabled");
  const rolesBefore = (await (await organizer.request.get(`${origin}/api/tournament-builder/${registeredEvent}`)).json()).snapshot;
  await page.getByLabel("New administrator’s Picktennt username", { exact: true }).fill("player");
  await page.getByRole("button", { name: "Find administrator account", exact: true }).click();
  await page.getByText("Grant access to: Player", { exact: true }).waitFor();
  await page.getByLabel("Reason for administrator change", { exact: true }).fill("Local owner reviewed helper access.");
  await page.getByRole("button", { name: "Review administrator change", exact: true }).click();
  await page.getByLabel("I reviewed this administrator access change and want to proceed.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Confirm administrator change", exact: true }).isEnabled(), false);
  await page.getByLabel("I reviewed this administrator access change and want to proceed.", { exact: true }).check();
  await page.getByRole("button", { name: "Confirm administrator change", exact: true }).click();
  await page.getByRole("button", { name: "Choose removal for Player", exact: true }).waitFor();
  const addedAdministrator = (await (await organizer.request.get(`${origin}/api/tournament-builder/${registeredEvent}`)).json()).snapshot;
  assert.deepEqual(new Set(addedAdministrator.admins.map((row: { user_id: string }) => row.user_id)), new Set([owner, player]));
  for (const key of ["definitions", "teams", "team_members", "tournament_players", "rounds", "matches", "standings", "stages"]) assert.deepEqual(addedAdministrator[key], rolesBefore[key]);
  assert.equal(addedAdministrator.event.roster_revision, rolesBefore.event.roster_revision);
  await other.goto(`${origin}/tournaments/${registeredEvent}/admin`);
  await other.getByRole("heading", { name: "Tournament administration", exact: true }).waitFor();
  assert.equal(await other.getByRole("heading", { name: "Manage tournament administrators", exact: true }).count(), 0);
  await page.getByRole("button", { name: "Choose removal for Player", exact: true }).click();
  await page.getByLabel("Reason for administrator change", { exact: true }).fill("Local owner removes temporary helper access.");
  await page.getByRole("button", { name: "Review administrator change", exact: true }).click();
  await page.getByLabel("I reviewed this administrator access change and want to proceed.", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("I reviewed this administrator access change and want to proceed.", { exact: true }).isChecked(), false);
  await page.getByLabel("I reviewed this administrator access change and want to proceed.", { exact: true }).check();
  await page.getByRole("button", { name: "Confirm administrator change", exact: true }).click();
  await page.getByRole("button", { name: "Choose removal for Player", exact: true }).waitFor({ state: "detached" });
  const removedAdministrator = (await (await organizer.request.get(`${origin}/api/tournament-builder/${registeredEvent}`)).json()).snapshot;
  assert.deepEqual(removedAdministrator.admins.map((row: { user_id: string }) => row.user_id), [owner]);
  for (const key of ["definitions", "teams", "team_members", "tournament_players", "rounds", "matches", "standings", "stages"]) assert.deepEqual(removedAdministrator[key], rolesBefore[key]);
  assert.equal(removedAdministrator.event.roster_revision, rolesBefore.event.roster_revision);
  await other.goto(`${origin}/tournaments/${registeredEvent}/admin`);
  assert.equal(await other.getByRole("heading", { name: "Tournament administration", exact: true }).count(), 0);
  cases.push("Native owner previews and explicitly confirms adding/removing an existing administrator; delegates cannot manage roles and removal leaves roster/results unchanged");
  await page.getByRole("button", { name: "Close registration", exact: true }).click();
  await page.getByLabel("I reviewed the current 2 approved entries, their players, and how they were registered.", { exact: true }).check();
  await page.getByRole("button", { name: "Lock reviewed roster and generate matches", exact: true }).click();
  const registeredStarted = page.waitForResponse(response => response.url().includes("commands?command=startTournament") && response.status() === 200);
  await page.getByRole("button", { name: "Start tournament", exact: true }).click(); await registeredStarted;
  const activeViaMcp = await adminTool("admin_get_tournament", { tournament_id: registeredEvent });
  const registeredMatch = activeViaMcp.matches.find((match: { is_current: boolean; status: string }) => match.is_current && match.status === "scheduled");
  assert.ok(registeredMatch);
  const resultOperation = randomUUID();
  const resultRequest = { tournament_id: registeredEvent, operation_id: resultOperation, expected_revision: activeViaMcp.event.revision, data: { match_id: registeredMatch.id, score_a: 11, score_b: 5, outcome_kind: "played", reason: "Organizer requested this local synthetic result." } };
  const savedViaMcp = await adminTool("admin_save_result", resultRequest);
  assert.equal(savedViaMcp.status, "completed");
  assert.deepEqual(await adminTool("admin_save_result", resultRequest), savedViaMcp);
  assert.equal(Number((await db.query<{ n: number }>("select count(*) n from tournament_operations where operation_id=$1", [resultOperation])).rows[0].n), 1);
  const finalViaMcp = await adminTool("admin_get_tournament", { tournament_id: registeredEvent });
  assert.equal(finalViaMcp.event.modular_state, "completed");
  assert.equal(finalViaMcp.stages.find((stage: { module_id: string }) => stage.module_id === "placements").output.groups.length, 2);
  await page.goto(`${origin}/tournaments/${registeredEvent}/leaderboard`);
  await page.locator("#placements ol li").first().waitFor(); assert.equal(await page.locator("#placements ol li").count(), 2);
  cases.push("Native administrator OAuth grant drives real HTTP MCP result command through SQL and final placements; identical receipt replay does not duplicate the result");
  const ownerVerifier = randomBytes(32).toString("base64url");
  const ownerAuthorization = new URL(authorization);
  ownerAuthorization.searchParams.set("scope", "tournaments:draft tournaments:admin tournaments:owner");
  ownerAuthorization.searchParams.set("state", "local-owner-state");
  ownerAuthorization.searchParams.set("code_challenge", createHash("sha256").update(ownerVerifier).digest("base64url"));
  await page.goto(ownerAuthorization.href);
  await page.getByRole("button", { name: "Allow owner actions", exact: true }).click();
  await page.getByRole("heading", { name: "Local callback intercepted", exact: true }).waitFor();
  const ownerCallback = new URL(receiver.url!, origin);
  assert.equal(ownerCallback.searchParams.get("state"), "local-owner-state");
  assert.equal(ownerCallback.searchParams.get("iss"), origin); assert.equal(receiver.consentOriginMatches, true);
  const ownerCode = ownerCallback.searchParams.get("code"); assert.ok(ownerCode);
  const ownerTokenResponse = await organizer.request.post(`${origin}/oauth/token`, { form: { grant_type: "authorization_code", client_id: client.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", resource: `${origin}/api/mcp`, code: ownerCode, code_verifier: ownerVerifier } });
  assert.equal(ownerTokenResponse.status(), 200);
  const ownerTokens = await ownerTokenResponse.json();
  assert.equal(ownerTokens.scope, "tournaments:draft tournaments:admin tournaments:owner");
  assert.ok(typeof ownerTokens.access_token === "string" && /^[A-Za-z0-9_-]{43}$/.test(ownerTokens.access_token));
  const ownerTools = await rpc("tools/list", {}, ownerTokens.access_token);
  assert.ok(ownerTools.tools.some((tool: { name: string }) => tool.name === "owner_preview_action"));
  assert.ok(ownerTools.tools.some((tool: { name: string }) => tool.name === "owner_commit_action"));
  const unchangedAdminTools = await rpc("tools/list", {});
  assert.ok(unchangedAdminTools.tools.every((tool: { name: string }) => !tool.name.startsWith("owner_")));
  async function ownerTool(name: string, args: Record<string, unknown>) {
    const result = await rpc("tools/call", { name, arguments: args }, ownerTokens.access_token);
    assert.ok(!result.isError, `MCP tool ${name} failed`);
    return JSON.parse(result.content.find((item: { type: string }) => item.type === "text").text);
  }
  const ownerDefinition = structuredClone(registeredDefinition); ownerDefinition.event.name = "Local owner-action consent";
  const ownerDraft = await ownerTool("create_draft", { operation_id: randomUUID(), data: { definition: ownerDefinition } });
  const ownerEvent = ownerDraft.tournament_id;
  const publication = await ownerTool("owner_preview_action", { tournament_id: ownerEvent, action: "publishTournament", data: {} });
  assert.equal(publication.impact.players_enrolled, 0); assert.equal(publication.impact.opens_registration, true);
  const publicationRequest = { tournament_id: ownerEvent, action: "publishTournament", data: publication.data, operation_id: randomUUID(), expected_revision: publication.event_revision, confirmed_owner_action: true, reviewed_action_hash: publication.preview_hash };
  const publicationReceipt = await ownerTool("owner_commit_action", publicationRequest);
  assert.equal(publicationReceipt.status, "registration_open");
  assert.deepEqual(await ownerTool("owner_commit_action", publicationRequest), publicationReceipt);
  async function ownerChange(action: string, data: Record<string, unknown>) {
    const preview = await ownerTool("owner_preview_action", { tournament_id: ownerEvent, action, data });
    return ownerTool("owner_commit_action", { tournament_id: ownerEvent, action, data: preview.data, operation_id: randomUUID(), expected_revision: preview.event_revision, confirmed_owner_action: true, reviewed_action_hash: preview.preview_hash });
  }
  await ownerChange("addAdministrator", { user_id: player, reason: "Owner confirmed the temporary local helper." });
  let ownerState = await ownerTool("owner_get_tournament", { tournament_id: ownerEvent });
  assert.deepEqual(new Set(ownerState.admins.map((row: { user_id: string }) => row.user_id)), new Set([owner, player]));
  await ownerChange("removeAdministrator", { user_id: player, reason: "Owner confirmed removing temporary helper access." });
  const cancellation = await ownerChange("cancelTournament", { reason: "Finish the isolated local owner-actions test." });
  assert.equal(cancellation.status, "cancelled");
  ownerState = await ownerTool("owner_get_tournament", { tournament_id: ownerEvent });
  assert.deepEqual(ownerState.admins.map((row: { user_id: string }) => row.user_id), [owner]);
  assert.equal(ownerState.teams.length, 0); assert.equal(ownerState.matches.length, 0);
  await page.goto(`${origin}/oauth/connections`);
  const ownerConnection = page.locator("form").filter({ hasText: "Owner actions and administrator management" });
  assert.equal(await ownerConnection.count(), 1);
  await ownerConnection.getByRole("button", { name: "Revoke access", exact: true }).click();
  const deniedOwner = await connector.request.post(`${origin}/api/mcp`, { headers: { authorization: `Bearer ${ownerTokens.access_token}`, accept: "application/json, text/event-stream" }, data: { jsonrpc: "2.0", id: ++rpcId, method: "tools/list", params: {} } });
  assert.equal(deniedOwner.status(), 401);
  assert.ok((await rpc("tools/list", {})).tools.every((tool: { name: string }) => !tool.name.startsWith("owner_")));
  cases.push("Fresh native all-three-scope consent enables exact owner preview/commit publication, replay, delegation/removal and cancellation over HTTP MCP; old admin grants stay restricted and native revocation immediately denies owner access");
  await connector.close();
  const extraA = randomUUID(), extraB = randomUUID();
  const fixture = await (await organizer.request.get(`${origin}/api/tournament-builder/${tournamentId}`)).json();
  fixture.snapshot.teams.push({ id: extraA, name: "Synthetic bronze A", entry_state: "approved" }, { id: extraB, name: "Synthetic bronze B", entry_state: "approved" });
  const ranked = [...fixture.snapshot.standings].sort((a, b) => Number(a.rank) - Number(b.rank));
  fixture.snapshot.stages.find((stage: { module_id: string }) => stage.module_id === "placements").output = { state: "completed", groups: [{ rank: 1, entryIds: [ranked[0].team_id] }, { rank: 2, entryIds: [ranked[1].team_id] }, { rank: 3, entryIds: [extraA, extraB] }] };
  await page.route(`${origin}/api/tournament-builder/${tournamentId}`, async (route) => { await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture) }); });
  await page.goto(`${origin}/tournaments/${tournamentId}/leaderboard`); await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page.getByText("Shared placement", { exact: true }).waitFor(); assert.equal(await page.locator("#placements ol li").count(), 3);
  cases.push("Separate synthetic final-placement fixture renders shared third place for both entries (render evidence only)");
  await page.screenshot({ path: resolve(output, "synthetic-shared-third.png"), fullPage: true });
  evidence.status = "passed"; evidence.completed_at = new Date().toISOString();
  writeFileSync(resolve(output, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ status: "passed", cases: cases.length, evidence: resolve(output, "evidence.json") }));
  await organizer.close(); await opponent.close();
} catch (error) {
  evidence.status = "failed"; evidence.error = error instanceof Error ? error.message : "Smoke test failed";
  writeFileSync(resolve(output, "evidence.json"), JSON.stringify(evidence, null, 2)); throw error;
} finally {
  await browser?.close(); stop(next); await close(proxy); await close(backend); await db.close();
}
}
void main().catch((error) => { console.error(error); process.exitCode = 1; });


