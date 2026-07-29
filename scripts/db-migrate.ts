// Apply the SQL migrations in src/db/migrations to the `connect` schema of the
// COMPANY Supabase project. Run AFTER putting DATABASE_URL in .dev.vars:
//   pnpm db:migrate
// The migration tracking table (__drizzle_migrations) lives in the `connect`
// schema too, so nothing touches the ERP's `public`/`drizzle` schemas.
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { scriptDb } from "./_env";

async function main() {
  const { db, sql } = scriptDb();
  console.log("Applying migrations to the `connect` schema…");
  await migrate(db, {
    migrationsFolder: "src/db/migrations",
    migrationsSchema: "connect",
    migrationsTable: "__drizzle_migrations",
  });
  console.log("Migrations applied.");
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
