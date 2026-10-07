import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getSql, resolveDatabaseUrl } from "./pg";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

/**
 * Request-scoped Drizzle client over Supabase Postgres (postgres.js) — the same
 * transport the ERP uses. postgres.js sockets can't cross the Worker request
 * boundary, so the client must never be a cross-request singleton; within ONE
 * request every getDb() must share one client (one Hyperdrive-pooled socket).
 *
 * The scope key is the request's ExecutionContext (`ctx`), which OpenNext hands
 * out fresh per request. It used to be React's cache(), which only memoizes
 * inside a React render: in a Route Handler every getDb() opened ANOTHER
 * client — a new socket, TLS to Hyperdrive and all, for every query. The
 * WhatsApp webhook paid for that: 2026-10-07 a Confirm tap took 9 s before the
 * flow's first node ran and 1.5–5 s per node after, hit the 30 s the runtime
 * allows after the response (waitUntil) at the 10th node, and the customer never
 * got the property questions. One socket per request puts a node at tens of
 * milliseconds of DB time.
 *
 * On Cloudflare (prod + `next dev` via OpenNext) the connection string comes
 * from the HYPERDRIVE binding, or DATABASE_URL when set (local dev / scripts) —
 * both surfaced through getCloudflareContext().env. A script under tsx (the CI
 * smoke tests) seeds that context with env only: with no ctx the env object is
 * the key, so the whole script shares one client instead of one per call.
 */
const clients = new WeakMap<object, DB>();

export function getDb(): DB {
  const { env, ctx } = getCloudflareContext();
  const key: object | null = ctx ?? (isWorkerRuntime() ? null : env);
  // No key to scope to (a Worker path without a request context): a fresh
  // client, never a shared one — sharing across requests is the one thing a
  // postgres.js socket must not do here.
  if (!key) return drizzle(getSql(resolveDatabaseUrl(env)), { schema });
  let db = clients.get(key);
  if (!db) {
    db = drizzle(getSql(resolveDatabaseUrl(env)), { schema });
    clients.set(key, db);
  }
  return db;
}

function isWorkerRuntime(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

export { schema };
