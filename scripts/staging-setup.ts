// Prepare the STAGING database (its own Supabase project, never production's).
// Reads DATABASE_URL from .dev.vars.staging (git-ignored), then:
//   1. applies every migration in src/db/migrations to the `connect` schema;
//   2. creates the two ERP tables login reads (public.roles, public.users) when
//      they are missing - staging has no ERP, so its staff accounts live here;
//   3. with --login <email> [--name "<name>"] [--role Owner], creates or resets
//      that staging login and prints a new password ONCE in this terminal;
//   4. with --seed, wipes and reloads the demo data (scripts/seed.ts).
//
//   pnpm staging:setup --seed --login you@example.com --name "Your Name"
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { getSql } from "../src/db/pg";
import { STAFF_TABLES_DDL, hashStaffPassword, newStaffPassword } from "../src/lib/staging-logins";

// The production Supabase project (wrangler.toml, Hyperdrive houzs-connect-pg).
const PRODUCTION_REF = "anogrigyjbduyzclzjgn";

function loadStagingVars() {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), ".dev.vars.staging"), "utf8");
  } catch {
    // The staging deploy workflow passes it from the STAGING_DATABASE_URL secret.
    if (process.env.DATABASE_URL) return;
    throw new Error("Create .dev.vars.staging with DATABASE_URL=<staging Supabase session pooler URL> first.");
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  loadStagingVars();
  const url = process.env.DATABASE_URL ?? "";
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new Error("DATABASE_URL in .dev.vars.staging is not a valid URL.");
  }
  if (url.includes(PRODUCTION_REF)) {
    throw new Error("Refusing: DATABASE_URL points at the PRODUCTION Supabase project.");
  }
  console.log(`Target: ${target.hostname} as ${decodeURIComponent(target.username)}`);

  // One connection at a time: the seed below opens its own.
  let sql = getSql(url);
  try {
    const { drizzle } = await import("drizzle-orm/postgres-js");
    await migrate(drizzle(sql), {
      migrationsFolder: "src/db/migrations",
      migrationsSchema: "connect",
      migrationsTable: "__drizzle_migrations",
    });
    console.log("Migrations applied.");

    for (const ddl of STAFF_TABLES_DDL) await sql.unsafe(ddl);
    console.log("Staff tables ready (public.roles, public.users).");

    if (process.argv.includes("--seed")) {
      await sql.end();
      const r = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/seed.ts"], {
        stdio: "inherit",
        env: { ...process.env, WHATSAPP_MODE: "DEMO" },
      });
      sql = getSql(url);
      if (r.status !== 0) throw new Error("Seeding failed.");
    }

    const email = arg("login")?.trim().toLowerCase();
    if (email) {
      const role = arg("role") ?? "Owner";
      const name = arg("name") ?? email;
      const [roleRow] = await sql<{ id: number }[]>`
        INSERT INTO public.roles (name) VALUES (${role})
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`;
      const password = newStaffPassword();
      await sql`
        INSERT INTO public.users (email, name, password_hash, status, role_id)
        VALUES (${email}, ${name}, ${await hashStaffPassword(password)}, 'active', ${roleRow.id})
        ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash,
          status = 'active', role_id = EXCLUDED.role_id`;
      console.log(`\nStaging login ready: ${email} (${role})\nPassword: ${password}\nIt is shown only now; run again to reset it.`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
