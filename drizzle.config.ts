import type { Config } from "drizzle-kit";

/**
 * Postgres drizzle-kit config. `generate` (schema -> SQL DDL) needs no DB
 * connection. `push`/`migrate` read DATABASE_URL at run time (load .dev.vars
 * first — see scripts). Everything is scoped to the `connect` schema so
 * drizzle-kit never inspects or diffs the ERP's `public` tables.
 */
export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  schemaFilter: ["connect"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
} satisfies Config;
