// Shared bootstrap for standalone scripts (migrate / seed). These run under tsx
// OUTSIDE the Worker/OpenNext runtime, so they can't use getCloudflareContext();
// they connect directly to Supabase via postgres.js using DATABASE_URL from
// .dev.vars (the same direct-pooler URL the ERP scripts use).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { getSql } from "../src/db/pg";
import * as schema from "../src/db/schema";

/** Minimal .dev.vars loader (KEY="value" lines). Does not overwrite an env var
 *  already set in the process. */
export function loadDevVars() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".dev.vars"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch {
    // no .dev.vars — rely on a DATABASE_URL already in the environment
  }
}

/** Build a direct (non-Hyperdrive) Drizzle client for scripts. Caller must
 *  `await sql.end()` when done. */
export function scriptDb() {
  loadDevVars();
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Put the Supabase pooler URL in .dev.vars first."
    );
  }
  const sql = getSql(url);
  const db = drizzle(sql, { schema });
  return { db, sql };
}
