// Seed / update the rebuilt WS-A conversation flows (decision B) into
// connect.automation, per company (lib/automation/flows: COMPANY_FLOW_SETS).
// Standalone (tsx), connects via .dev.vars DATABASE_URL like the other scripts.
//
//   pnpm db:seed:flows                             # every company set
//   pnpm db:seed:flows --company 2990              # just one company (by slug)
//   pnpm db:seed:flows --company 2990 --dry-run    # report only, write nothing
//
// IDEMPOTENT and NON-destructive: it never wipes and never creates contacts or
// sends anything. Flows and their forms are upserted by (companyId, name):
//   - new            -> inserted as DRAFT / disabled (the owner publishes later),
//                       UNLESS the company's set is marked `enabled` (The Conts),
//                       which inserts PUBLISHED / enabled so the ERP can fire it.
//   - already there  -> graph / copy / trigger refreshed, version bumped, but
//                       status + enabled are LEFT ALONE so re-seeding to ship new
//                       flow content never silently unpublishes a live flow (and
//                       never re-enables one the owner has since disabled).
// Unlike seed.ts this is safe to run against a live database; it only writes
// definitions, so there is no LIVE refusal. Note the refresh: re-seeding a
// company overwrites its seeded graphs with the code's, so pass --company to
// touch only the company you mean to.
import { and, eq } from "drizzle-orm";
import { scriptDb } from "./_env";
import { automation, channel, company, form } from "../src/db/schema";
import {
  COMPANY_FLOW_SETS,
  graphForCompany,
  templateGaps,
  validateGraph,
  type SeedForm,
} from "../src/lib/automation/flows";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function upsertForm(
  db: ReturnType<typeof scriptDb>["db"],
  companyId: string,
  f: SeedForm,
  dryRun: boolean
): Promise<string> {
  const existing = await db.query.form.findFirst({
    where: and(eq(form.companyId, companyId), eq(form.name, f.name)),
  });
  if (dryRun) return existing?.id ?? `(new form "${f.name}")`;
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
  const only = arg("company");
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Seeding rebuilt WS-A flows${only ? ` for "${only}"` : ""}${dryRun ? " (DRY RUN — nothing written)" : ""}…`);

  // Ensure form.meta_flow_id exists (migration 0009). The Drizzle migrate runner
  // can't create its tracking table in the connect schema (owned by
  // houzs_connect), so apply this one column here — idempotently, as the owner
  // role we inherit. Drizzle selects all form columns, so without it the form
  // upsert's query references a column that isn't there yet.
  if (!dryRun) await sql`ALTER TABLE connect.form ADD COLUMN IF NOT EXISTS meta_flow_id text`;

  // Each company gets only its own set — Hookka (manufacturing) and The Conts
  // have none, so they never receive delivery flows.
  const sets = COMPANY_FLOW_SETS.filter((s) => !only || s.slug === only);
  if (sets.length === 0) {
    console.log(`No flow set for "${only}". Known: ${COMPANY_FLOW_SETS.map((s) => s.slug).join(", ")}`);
    await sql.end();
    return;
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const set of sets) {
    const co = await db.query.company.findFirst({ where: eq(company.slug, set.slug) });
    if (!co) {
      console.log(`- "${set.slug}": no such company in connect.company, skipping`);
      continue;
    }
    // An automation needs a channel to send from. Prefer the default channel.
    const channels = await db.query.channel.findMany({ where: eq(channel.companyId, co.id) });
    const ch = channels.find((c) => c.isDefault) ?? channels[0];
    if (!ch) {
      console.log(`- ${co.name}: no channel, skipping`);
      continue;
    }
    console.log(`${co.name} → sends from ${ch.phone}`);

    for (const flow of set.flows) {
      // 1) Upsert this flow's forms for this company, collecting their ids.
      const formIds: Record<string, string> = {};
      for (const f of flow.forms) {
        formIds[f.key] = await upsertForm(db, co.id, f, dryRun);
      }

      // 2) Build, swap in this company's templates, validate. A broken graph —
      //    or one that would send another company's branded template — is
      //    never written.
      const graph = graphForCompany(flow.build(formIds), set);
      const problems = [
        ...validateGraph(graph),
        ...templateGaps(graph, set).map((t) => `template "${t}" has no ${set.slug} copy and is not brand-free`),
      ];
      if (problems.length > 0) {
        console.error(`- ${co.name}: "${flow.name}" INVALID, skipped:`);
        for (const p of problems) console.error(`    * ${p}`);
        skipped++;
        continue;
      }
      const templates = [
        ...new Set(graph.nodes.filter((n) => n.type === "send_template").map((n) => n.data?.templateName)),
      ].join(", ");

      // 3) Upsert the automation by (companyId, name).
      const existing = await db.query.automation.findFirst({
        where: and(eq(automation.companyId, co.id), eq(automation.name, flow.name)),
      });
      if (existing) {
        if (!dryRun) {
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
        }
        updated++;
        console.log(`- ${co.name}: ${dryRun ? "would update" : "updated"} "${flow.name}" (v${(existing.version ?? 1) + 1})${templates ? ` [${templates}]` : ""}`);
      } else {
        // Most sets insert DRAFT/disabled (owner publishes later); a set marked
        // `enabled` (The Conts) inserts PUBLISHED/enabled so the ERP can fire it
        // by name straight away. Insert only — re-seeds never touch these two.
        const enabled = set.enabled ?? false;
        if (!dryRun) {
          await db.insert(automation).values({
            companyId: co.id,
            channelId: ch.id,
            name: flow.name,
            description: flow.description,
            triggerType: flow.triggerType,
            triggerConfig: flow.triggerConfig,
            status: enabled ? "PUBLISHED" : "DRAFT",
            enabled,
            graph,
          });
        }
        inserted++;
        const stateLabel = enabled ? "PUBLISHED, enabled" : "DRAFT, disabled";
        console.log(`- ${co.name}: ${dryRun ? "would insert" : "inserted"} "${flow.name}" (${stateLabel})${templates ? ` [${templates}]` : ""}`);
      }
    }
  }

  console.log(`Done${dryRun ? " (dry run)" : ""}. inserted=${inserted} updated=${updated} skipped=${skipped}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
