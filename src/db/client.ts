import { cache } from "react";
import { drizzle } from "drizzle-orm/postgres-js";
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
export const getDb = cache(() => {
  const { env } = getCloudflareContext();
  return drizzle(getSql(resolveDatabaseUrl(env)), { schema });
});

export type DB = ReturnType<typeof getDb>;
export { schema };
