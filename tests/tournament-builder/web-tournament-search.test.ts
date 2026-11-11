import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { searchTournaments } from "../../lib/tournament/search";

const id = "12345678-1234-4123-8123-123456789abc";
const tournament = { id, name: "Hidden event", status: "registration", modular_state: "registration_open", engine_version: "modular_v1", is_public: false, join_code: "ABCDEF" };

function client(rows: object[], found?: object | null) {
  const filters: string[] = [];
  const query = {
    select() { return this; }, order() { return this; }, limit() { return this; },
    eq(field: string, value: string) { filters.push(`${field}=${value}`); return this; },
    ilike(field: string, value: string) { filters.push(`${field}=${value}`); return this; },
    maybeSingle: async () => ({ data: found, error: null }),
    then(resolve: (value: unknown) => void) { resolve({ data: rows, error: null }); },
  };
  return { db: { from: () => query } as unknown as SupabaseClient, filters };
}

test("an exact ID finds a published unlisted modular tournament", async () => {
  const visible = client([]), admin = client([], tournament);
  const result = await searchTournaments(visible.db, ` ${id} `, async () => admin.db);
  assert.deepEqual(visible.filters, [`id=${id}`]);
  assert.deepEqual(admin.filters, [`id=${id}`]);
  assert.equal(result[0].href, `/tournaments/${id}`);
});

test("an unlisted legacy tournament uses its invitation link", async () => {
  const admin = client([], { ...tournament, engine_version: "legacy", modular_state: null });
  assert.equal((await searchTournaments(client([]).db, id, async () => admin.db))[0].href, "/join/ABCDEF");
});

test("name searches and unauthenticated lookups do not use privileged access", async () => {
  const visible = client([]);
  assert.deepEqual(await searchTournaments(visible.db, "Hidden", async () => { throw Error("unexpected privileged lookup"); }), []);
  assert.deepEqual(visible.filters, ["name=%Hidden%"]);
  assert.deepEqual(await searchTournaments(client([]).db, id), []);
});

test("unlisted drafts stay private, while visible drafts remain accessible", async () => {
  const draft = { ...tournament, modular_state: "draft", status: "draft" };
  assert.deepEqual(await searchTournaments(client([]).db, id, async () => client([], draft).db), []);
  assert.equal((await searchTournaments(client([draft]).db, id, async () => { throw Error("unexpected privileged lookup"); }))[0].href, `/tournaments/${id}`);
});

