import { cache } from "react";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSql, resolveDatabaseUrl } from "./pg";
import * as schema from "./schema";

/**
 * Request-scoped Drizzle client over Supabase Postgres (postgres.js) — the same
 * transport the ERP uses. postgres.js sockets can't cross the Worker request
 * boundary, so the client must never be a cross-request singleton. React's
 * cache() memoizes it per request instead: every getDb() in one request shares
 * one client (one Hyperdrive-pooled socket), and the next request gets a fresh
 * one. Hyperdrive pools origin-side, so this is cheap.
 *
 * On Cloudflare (prod + `next dev` via OpenNext) the connection string comes
 * from the HYPERDRIVE binding, or DATABASE_URL when set (local dev / scripts) —
 * both surfaced through getCloudflareContext().env.
 */
export type DB = PostgresJsDatabase<typeof schema>;

export const getDb = cache((): DB => {
  const scripted = (globalThis as Record<symbol, unknown>)[SCRIPT_DB] as DB | undefined;
  if (scripted) return scripted;
  const { env } = getCloudflareContext();
  return drizzle(getSql(resolveDatabaseUrl(env)), { schema });
});

/**
 * Outside the Worker (scripts under tsx: the CI smoke tests) React's cache()
 * has no request to scope to, so every getDb() above would open ANOTHER
 * postgres.js client — one socket each, held for idle_timeout — and a test
 * that drives the engine through a few hundred calls hits Postgres's
 * "sorry, too many clients already" (CI, 2026-10-07). A script that already
 * holds a client registers it under this symbol and the whole run shares it.
 * Nothing in the Worker sets it, so prod keeps its request-scoped client.
 */
export const SCRIPT_DB = Symbol.for("houzs-connect.script-db");

export { schema };
