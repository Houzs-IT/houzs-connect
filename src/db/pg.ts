// ---------------------------------------------------------------------------
// Supabase Postgres client for Cloudflare Workers.
//
// Ported verbatim (bar the schema note) from the Houzs ERP connection layer
// (houzs-work/backend/src/db/pg.ts). Houzs Connect deploys the same way:
// Hyperdrive in front of Supabase's Supavisor transaction pooler, one company
// Supabase project shared with the ERP. Connect's tables live in the `connect`
// schema (see db/schema.ts), so this file just opens the socket; Drizzle
// schema-qualifies every table.
//
// HARD-WON RULES (do not "optimize" these without reading the ERP's why):
//   * prepare: false      -- the transaction pooler does NOT support prepared
//     statements; prepare:true 500s every query with a Parse/Bind rejection.
//   * Hyperdrive branch: NO `ssl` -- Hyperdrive terminates TLS origin-side.
//   * Hyperdrive branch: NO `connect_timeout` -- a cap turns slow-but-working
//     queries into fast-fail 500s under load.
//   * max: 1 -- one socket per request; Hyperdrive pools origin-side. Never
//     cache the client across requests (a socket can't cross the Worker
//     request boundary: "Cannot perform I/O on behalf of a different request").
// ---------------------------------------------------------------------------
import postgres, { type Sql } from "postgres";

// Coerce Postgres BIGINT (int8, OID 20) from string to JS Number. COUNT(*) and
// SUM() come back as strings by default and string math silently corrupts
// totals; safe up to 2^53, well above anything in this schema.
const bigintAsNumber = {
  to: 20,
  from: [20],
  parse: (x: string) => Number(x),
  serialize: (x: number | string) => String(x),
};

/**
 * Fresh postgres.js client for the given connection URL. Detects a
 * Hyperdrive-backed URL by its `*.hyperdrive.local` host. Prod reads
 * `env.HYPERDRIVE.connectionString`; local dev reads the direct Supabase
 * pooler URL from `DATABASE_URL` in .dev.vars.
 */
export function getSql(databaseUrl: string): Sql {
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL / HYPERDRIVE.connectionString is empty. " +
        "Set DATABASE_URL in .dev.vars (local) or bind HYPERDRIVE (prod)."
    );
  }

  const isHyperdrive = /hyperdrive\.local/i.test(databaseUrl);

  // Opt-in escape hatch for a plain, non-TLS Postgres (CI service container, local
  // `docker run postgres`). Only triggers when the URL explicitly asks for it, so
  // prod/dev Supabase URLs (which never carry sslmode=disable) keep TLS untouched.
  const sslDisabled = /[?&]sslmode=disable\b/i.test(databaseUrl);

  return isHyperdrive
    ? postgres(databaseUrl, {
        max: 1,
        prepare: false, // transaction pooler: no prepared statements
        fetch_types: false,
        idle_timeout: 0,
        types: { bigint: bigintAsNumber },
      })
    : postgres(databaseUrl, {
        // LOCAL/dev + scripts ONLY (prod uses the Hyperdrive branch above, TLS
        // terminated origin-side). Still TLS-encrypted, but don't verify the
        // chain: some dev machines run TLS-intercepting AV/proxies that present a
        // self-signed root, which trips a full chain check (SELF_SIGNED_CERT_IN_CHAIN).
        // sslmode=disable turns TLS off entirely for a plain CI/local Postgres.
        ssl: sslDisabled ? false : { rejectUnauthorized: false },
        prepare: false,
        max: 1,
        idle_timeout: 20,
        connect_timeout: 10,
        fetch_types: false,
        types: { bigint: bigintAsNumber },
      });
}

/** Resolve the live connection string from the Worker env, prod or local.
 *  DATABASE_URL wins when present (local dev / scripts); prod falls through to
 *  the Hyperdrive binding. */
export function resolveDatabaseUrl(env: {
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;
}): string {
  return env.DATABASE_URL || env.HYPERDRIVE?.connectionString || "";
}
