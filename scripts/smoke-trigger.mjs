// Deterministic, DB-backed smoke test for the automation trigger seam.
//
// Proves end-to-end that a human-built ACTION_CALLBACK automation actually RUNS
// when the ERP webhook fires it, by importing the REAL dispatch + engine code
// (no reimplementation) and asserting against the live DB rows they write.
//
// Flow exercised:
//   Trigger(ACTION_CALLBACK "SMOKE") -> send_text -> ask_buttons
//     -> criteria_router -> send_text -> end
//
//   1. handleErpWebhook({ automation: "SMOKE", ... })  → run starts, pauses at the
//      buttons node, two outbound messages recorded.
//   2. handleInboundMessage(contactId, { buttonId })   → run resumes through the
//      router to the final send_text and completes; a third outbound is recorded.
//   3. Two more sends to the same customer → the earlier run is SUPERSEDED, only
//      the latest waits; one tap moves exactly one run and sends ONE reply.
//   4. Two different automations waiting on the same customer → a tap answers
//      the most recently asked question only; the other run keeps waiting.
//
// Usage (needs a Postgres it can create the `connect` schema in — CI uses a plain
// service container, so pass sslmode=disable there):
//   DATABASE_URL='postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable' \
//     node scripts/smoke-trigger.mjs
//
// Schema setup: the script runs the app's own Drizzle migrations
// (src/db/migrations) against the target DB first, so a fresh empty Postgres is
// all CI needs — no manual DDL. Exits non-zero on any failed assertion.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { register as registerCjs } from "tsx/cjs/api";
import { register as registerEsm } from "tsx/esm/api";

// The engine/dispatch are TypeScript that also uses `@/…` path aliases and nested
// CJS requires; register both tsx hooks so `import()` of the real .ts resolves.
registerCjs();
registerEsm();

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..");

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function main() {
  // Load DATABASE_URL from the environment (or .dev.vars, same as db:migrate/seed).
  const { scriptDb, loadDevVars } = await import("./_env.ts");
  loadDevVars();
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Pass it inline, e.g.\n" +
        "  DATABASE_URL='postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable' node scripts/smoke-trigger.mjs"
    );
  }

  // Seed the Cloudflare context global so the app's getDb() (which normally reads
  // env from the Worker binding) resolves this same DATABASE_URL when the engine
  // runs outside the Worker runtime.
  globalThis[Symbol.for("__cloudflare-context__")] = { env: { DATABASE_URL: url } };

  // Direct client for schema setup + assertions. The engine's own getDb() calls
  // share ONE client of their own for the whole run, keyed on that seeded env
  // (see src/db/client.ts) — not one socket per call.
  const { db, sql } = scriptDb();

  // (0) Ensure the `connect` schema + tables exist (idempotent on an existing DB,
  //     full create on an empty CI Postgres).
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  await migrate(db, {
    migrationsFolder: resolve(projectRoot, "src/db/migrations"),
    migrationsSchema: "connect",
    migrationsTable: "__drizzle_migrations",
  });

  const { and, eq, inArray } = await import("drizzle-orm");
  const schema = await import("../src/db/schema.ts");
  const {
    company,
    channel,
    contact,
    conversation,
    message,
    automation,
    automationRun,
    webhookEvent,
  } = schema;

  const { handleErpWebhook, handleInboundMessage } = await import(
    "../src/lib/automation/dispatch.ts"
  );

  const SLUG = "smoke-trigger-co";
  const CALLBACK_ID = "SMOKE";
  const CALLBACK_ID_B = "SMOKE-B";
  const PHONE = "60111111111";

  // (1) Teardown any prior smoke data for a deterministic starting point. The
  //     schema has no FK constraints, so plain deletes in dependency order suffice.
  const prior = await db.query.company.findFirst({ where: eq(company.slug, SLUG) });
  if (prior) {
    const autos = await db
      .select({ id: automation.id })
      .from(automation)
      .where(eq(automation.companyId, prior.id));
    const contacts = await db
      .select({ id: contact.id })
      .from(contact)
      .where(eq(contact.companyId, prior.id));
    const contactIds = contacts.map((c) => c.id);
    const convos = contactIds.length
      ? await db
          .select({ id: conversation.id })
          .from(conversation)
          .where(inArray(conversation.contactId, contactIds))
      : [];
    const convoIds = convos.map((c) => c.id);
    if (convoIds.length)
      await db.delete(message).where(inArray(message.conversationId, convoIds));
    if (contactIds.length)
      await db.delete(conversation).where(inArray(conversation.contactId, contactIds));
    if (autos.length)
      await db
        .delete(automationRun)
        .where(inArray(automationRun.automationId, autos.map((a) => a.id)));
    await db.delete(automation).where(eq(automation.companyId, prior.id));
    await db.delete(contact).where(eq(contact.companyId, prior.id));
    await db.delete(channel).where(eq(channel.companyId, prior.id));
    await db.delete(company).where(eq(company.id, prior.id));
  }
  await db.delete(webhookEvent).where(inArray(webhookEvent.eventType, [CALLBACK_ID, CALLBACK_ID_B]));

  // (2) Create the throwaway company + channel + the ACTION_CALLBACK automation.
  const [companyRow] = await db
    .insert(company)
    .values({ name: "Smoke Trigger Co", slug: SLUG })
    .returning();
  const [channelRow] = await db
    .insert(channel)
    .values({
      companyId: companyRow.id,
      displayName: "Smoke WhatsApp",
      phone: "60100000000",
      mode: "DEMO",
      isDefault: true,
    })
    .returning();

  const makeGraph = (callbackId) => ({
    nodes: [
      { id: "n_trigger", type: "trigger", x: 40, y: 200, data: { event: "ACTION_CALLBACK", callbackId } },
      { id: "n_hello", type: "send_text", x: 260, y: 200, data: { message: "Hi {full_name}! Your order {ref_1} is being processed." } },
      {
        id: "n_ask",
        type: "ask_buttons",
        x: 480,
        y: 200,
        data: {
          message: "Confirm delivery for {ref_1}?",
          buttons: [
            { id: "yes", label: "Yes" },
            { id: "no", label: "No" },
          ],
        },
      },
      {
        id: "n_router",
        type: "criteria_router",
        x: 700,
        y: 200,
        data: { rules: [{ branch: "b_match", field: "status", op: "eq", value: callbackId }] },
      },
      { id: "n_final", type: "send_text", x: 920, y: 140, data: { message: "Thank you {full_name}, delivery for {ref_1} is confirmed." } },
      { id: "n_end", type: "end", x: 1140, y: 200, data: {} },
    ],
    edges: [
      { from: "n_trigger", to: "n_hello" },
      { from: "n_hello", to: "n_ask" },
      { from: "n_ask", to: "n_router", branch: "yes" },
      { from: "n_ask", to: "n_router", branch: "default" },
      { from: "n_router", to: "n_final", branch: "b_match" },
      { from: "n_router", to: "n_end", branch: "default" },
      { from: "n_final", to: "n_end" },
    ],
  });
  const graph = makeGraph(CALLBACK_ID);

  const [autoRow] = await db
    .insert(automation)
    .values({
      companyId: companyRow.id,
      channelId: channelRow.id,
      name: "Smoke ACTION_CALLBACK",
      description: "smoke-trigger test automation",
      triggerType: "ACTION_CALLBACK",
      triggerConfig: { event: "ACTION_CALLBACK", callbackId: CALLBACK_ID, keywords: [] },
      status: "PUBLISHED",
      enabled: true,
      graph,
    })
    .returning();

  // (3) Fire the ERP webhook with the matching Action Callback Id.
  const res = await handleErpWebhook({
    companySlug: SLUG,
    phone: PHONE,
    name: "Smoke Tester",
    automation: CALLBACK_ID,
    attributes: { status: CALLBACK_ID, ref_1: "SMK-1" },
  });

  assert(res.ok, `webhook returned ok=false: ${JSON.stringify(res)}`);
  assert(res.runs.length === 1, `expected exactly 1 run to fire, got ${res.runs.length}`);
  const contactId = res.contactId;
  const conversationId = res.conversationId;
  assert(!!conversationId, "webhook did not resolve a conversation");

  // Run should be paused at the buttons node.
  let run = await db.query.automationRun.findFirst({
    where: and(eq(automationRun.automationId, autoRow.id), eq(automationRun.contactId, contactId)),
  });
  assert(run, "no automationRun row was created");
  assert(run.status === "waiting", `expected run status 'waiting', got '${run.status}'`);
  assert(run.cursorNodeId === "n_ask", `expected cursor at n_ask, got '${run.cursorNodeId}'`);

  const outAfterStart = await db
    .select()
    .from(message)
    .where(and(eq(message.conversationId, conversationId), eq(message.direction, "OUT")));
  assert(
    outAfterStart.length >= 2,
    `expected >=2 outbound messages after start (hello + ask), got ${outAfterStart.length}`
  );
  const askMsg = outAfterStart.find((m) => m.type === "INTERACTIVE");
  assert(askMsg, "expected an INTERACTIVE (buttons) outbound message");

  // (4) Simulate the customer tapping "Yes" — resumes the waiting run.
  const inbound = await handleInboundMessage(contactId, { buttonId: "yes" });
  assert(inbound.resumed >= 1, `expected the waiting run to resume, got resumed=${inbound.resumed}`);

  // Run should now be completed, having gone through the router to the final send.
  run = await db.query.automationRun.findFirst({
    where: and(eq(automationRun.automationId, autoRow.id), eq(automationRun.contactId, contactId)),
  });
  assert(run.status === "completed", `expected run status 'completed', got '${run.status}'`);

  const log = Array.isArray(run.log) ? run.log : [];
  const routed = log.find((e) => e && e.type === "criteria_router");
  assert(routed && routed.matched === "b_match", "criteria_router did not match the expected branch");

  const outAfterReply = await db
    .select()
    .from(message)
    .where(and(eq(message.conversationId, conversationId), eq(message.direction, "OUT")));
  assert(
    outAfterReply.length >= 3,
    `expected >=3 outbound messages after reply (hello + ask + final), got ${outAfterReply.length}`
  );

  // (5) ONE live run per automation per customer. Two more sends to the same
  //     phone: the first of them must be SUPERSEDED by the second, and the
  //     customer's one tap must move exactly one run and produce ONE reply —
  //     not one per send (live 2026-10-07: three stale runs, three replies).
  const countOut = async () =>
    (
      await db
        .select()
        .from(message)
        .where(and(eq(message.conversationId, conversationId), eq(message.direction, "OUT")))
    ).length;
  const send = (cb, ref) =>
    handleErpWebhook({
      companySlug: SLUG,
      phone: PHONE,
      name: "Smoke Tester",
      automation: cb,
      attributes: { status: cb, ref_1: ref },
    });
  const res2 = await send(CALLBACK_ID, "SMK-2");
  const res3 = await send(CALLBACK_ID, "SMK-3");
  assert(res2.ok && res2.runs.length === 1, `second send: ${JSON.stringify(res2)}`);
  assert(res3.ok && res3.runs.length === 1, `third send: ${JSON.stringify(res3)}`);
  const runById = async (id) => db.query.automationRun.findFirst({ where: eq(automationRun.id, id) });
  let run2 = await runById(res2.runs[0]);
  let run3 = await runById(res3.runs[0]);
  assert(run2.status === "superseded", `earlier run should be superseded by the next send, got '${run2.status}'`);
  assert(run2.cursorNodeId === null, "a superseded run must not keep a cursor");
  assert(
    (Array.isArray(run2.log) ? run2.log : []).some((e) => e && e.type === "superseded"),
    "superseding must be on the earlier run's log"
  );
  assert(run3.status === "waiting", `latest run should be waiting, got '${run3.status}'`);
  assert((await runById(run.id)).status === "completed", "a finished run is never superseded");
  const outBeforeTap = await countOut();
  const tap2 = await handleInboundMessage(contactId, { buttonId: "yes" });
  assert(tap2.resumed === 1, `one tap must move exactly one run, got resumed=${tap2.resumed}`);
  run2 = await runById(res2.runs[0]);
  run3 = await runById(res3.runs[0]);
  assert(run2.status === "superseded", `superseded run must never resume, got '${run2.status}'`);
  assert(run3.status === "completed", `latest run should complete on the tap, got '${run3.status}'`);
  const outAfterTap = await countOut();
  assert(
    outAfterTap === outBeforeTap + 1,
    `one tap must send ONE reply, got ${outAfterTap - outBeforeTap}`
  );

  // (6) Two DIFFERENT automations waiting on the same customer: the tap answers
  //     the most recently asked question only; the other keeps waiting.
  const [autoB] = await db
    .insert(automation)
    .values({
      companyId: companyRow.id,
      channelId: channelRow.id,
      name: "Smoke ACTION_CALLBACK B",
      description: "smoke-trigger test automation B",
      triggerType: "ACTION_CALLBACK",
      triggerConfig: { event: "ACTION_CALLBACK", callbackId: CALLBACK_ID_B, keywords: [] },
      status: "PUBLISHED",
      enabled: true,
      graph: makeGraph(CALLBACK_ID_B),
    })
    .returning();
  const resA = await send(CALLBACK_ID, "SMK-4");
  const resB = await send(CALLBACK_ID_B, "SMK-5");
  assert(resA.ok && resA.runs.length === 1, `send A: ${JSON.stringify(resA)}`);
  assert(resB.ok && resB.runs.length === 1, `send B: ${JSON.stringify(resB)}`);
  assert(resB.triggered.includes(autoB.name), "send B should fire automation B");
  let runA = await runById(resA.runs[0]);
  let runB = await runById(resB.runs[0]);
  assert(runA.status === "waiting", `run A (other automation) must stay live, got '${runA.status}'`);
  assert(runB.status === "waiting", `run B should be waiting, got '${runB.status}'`);
  const outBeforeTap3 = await countOut();
  const tap3 = await handleInboundMessage(contactId, { buttonId: "yes" });
  assert(tap3.resumed === 1, `a tap answers one question, got resumed=${tap3.resumed}`);
  runA = await runById(resA.runs[0]);
  runB = await runById(resB.runs[0]);
  assert(runB.status === "completed", `the latest question (B) should be answered, got '${runB.status}'`);
  assert(runA.status === "waiting", `the earlier question (A) must still wait, got '${runA.status}'`);
  assert((await countOut()) === outBeforeTap3 + 1, "the tap must send one reply, not one per waiting run");

  console.log("SMOKE PASS:");
  console.log(`  automation:     ${autoRow.id} (${autoRow.name})`);
  console.log(`  contact:        ${contactId}`);
  console.log(`  conversation:   ${conversationId}`);
  console.log(`  run:            ${run.id} → ${run.status}`);
  console.log(`  outbound msgs:  ${outAfterReply.length}`);
  console.log(`  router matched: ${routed.matched}`);

  await sql.end();
  process.exit(0);
}

main().catch((e) => {
  // Print the full error (with cause, e.g. the underlying ECONNREFUSED) so CI logs
  // are actionable, not just the migrator's wrapped "Failed query" message.
  console.error(e);
  process.exit(1);
});
