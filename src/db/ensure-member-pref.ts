// Per-person UI preferences table, self-applied at runtime.
//
// Connect deploys land before `pnpm db:migrate`, so a table in schema.ts but not
// in Postgres would break every path that reads it — here the contacts page.
// Same convention as ensure-conversation-member.ts / ensure-activity-log.ts.

import { sql } from "drizzle-orm";
import type { DB } from "./client";

let ensured: Promise<void> | null = null;

async function run(db: DB): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "connect"."member_pref" (
      "email" text PRIMARY KEY NOT NULL,
      "contacts_cols" text,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `);
}

export async function ensureMemberPrefTable(db: DB): Promise<void> {
  if (!ensured) {
    ensured = run(db).catch((e) => {
      ensured = null;
      throw e;
    });
  }
  await ensured;
}
