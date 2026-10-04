// Seed / update the rebuilt WS-A conversation flows (decision B) into
// connect.automation, for every company that has a channel. Standalone (tsx),
// connects via .dev.vars DATABASE_URL like the other scripts.
//
//   pnpm db:seed:flows
//
// IDEMPOTENT and NON-destructive: it never wipes and never creates contacts or
// sends anything. Flows and their forms are upserted by (companyId, name):
//   - new            -> inserted as DRAFT / disabled (the owner publishes later)
//   - already there  -> graph / copy / trigger refreshed, version bumped, but
//                       status + enabled are LEFT ALONE so re-seeding to ship new
//                       flow content never silently unpublishes a live flow.
// Unlike seed.ts this is safe to run against a live database; it only writes
// definitions, so there is no LIVE refusal.
import { and, eq } from "drizzle-orm";
import { scriptDb } from "./_env";
import { automation, channel, company, form } from "../src/db/schema";
import { REBUILD_FLOWS, validateGraph, type SeedForm } from "../src/lib/automation/flows";

async function upsertForm(
  db: ReturnType<typeof scriptDb>["db"],
  companyId: string,
  f: SeedForm
): Promise<string> {
  const existing = await db.query.form.findFirst({
    where: and(eq(form.companyId, companyId), eq(form.name, f.name)),
  });
  if (existing) {
    // Keep status + metaFlowId: a published form keeps its Meta flow id.
    await db.update(form).set({ fields: f.fields }).where(eq(form.id, existing.id));
    return existing.id;
  }
  const [row] = await db
    .insert(form)
    .values({ companyId, name: f.name, status: "draft", fields: f.fields })
    .returning();
  return row.id;
}

async function main() {
  const { db, sql } = scriptDb();
  console.log("Seeding rebuilt WS-A flows…");

  // Ensure form.meta_flow_id exists (migration 0009). The Drizzle migrate runner
  // can't create its tracking table in the connect schema (owned by
  // houzs_connect), so apply this one column here — idempotently, as the owner
  // role we inherit. Drizzle selects all form columns, so without it the form
  // upsert's query references a column that isn't there yet.
  await sql`ALTER TABLE connect.form ADD COLUMN IF NOT EXISTS meta_flow_id text`;

  // WS-A flows are Houzs's — 2990's sends route to the Houzs number too, and
  // Hookka (manufacturing) must NOT receive delivery flows. Target Houzs by slug
  // rather than every company that happens to have a channel.
  const HOUZS_SLUG = "houzs-century";
  const companies = await db.query.company.findMany({ where: eq(company.slug, HOUZS_SLUG) });
  if (companies.length === 0) {
    console.log(`No company with slug "${HOUZS_SLUG}" in connect.company — nothing to seed.`);
    await sql.end();
    return;
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const co of companies) {
    // An automation needs a channel to send from. Prefer the default channel.
    const channels = await db.query.channel.findMany({ where: eq(channel.companyId, co.id) });
    const ch = channels.find((c) => c.isDefault) ?? channels[0];
    if (!ch) {
      console.log(`- ${co.name}: no channel, skipping`);
      continue;
    }

    for (const flow of REBUILD_FLOWS) {
      // 1) Upsert this flow's forms for this company, collecting their ids.
      const formIds: Record<string, string> = {};
      for (const f of flow.forms) {
        formIds[f.key] = await upsertForm(db, co.id, f);
      }

      // 2) Build + validate the graph. A broken graph is never written.
      const graph = flow.build(formIds);
      const problems = validateGraph(graph);
      if (problems.length > 0) {
        console.error(`- ${co.name}: "${flow.name}" INVALID, skipped:`);
        for (const p of problems) console.error(`    * ${p}`);
        skipped++;
        continue;
      }

      // 3) Upsert the automation by (companyId, name).
      const existing = await db.query.automation.findFirst({
        where: and(eq(automation.companyId, co.id), eq(automation.name, flow.name)),
      });
      if (existing) {
        await db
          .update(automation)
          .set({
            description: flow.description,
            triggerType: flow.triggerType,
            triggerConfig: flow.triggerConfig,
            graph,
            version: (existing.version ?? 1) + 1,
            // status + enabled deliberately untouched.
          })
          .where(eq(automation.id, existing.id));
        updated++;
        console.log(`- ${co.name}: updated "${flow.name}" (v${(existing.version ?? 1) + 1})`);
      } else {
        await db.insert(automation).values({
          companyId: co.id,
          channelId: ch.id,
          name: flow.name,
          description: flow.description,
          triggerType: flow.triggerType,
          triggerConfig: flow.triggerConfig,
          status: "DRAFT",
          enabled: false,
          graph,
        });
        inserted++;
        console.log(`- ${co.name}: inserted "${flow.name}" (DRAFT, disabled)`);
      }
    }
  }

  console.log(`Done. inserted=${inserted} updated=${updated} skipped=${skipped}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
